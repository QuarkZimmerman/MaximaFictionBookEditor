// Feature 014 (contracts/print-service.md, plan DP-12, tasks T012): prints the PDF export's paged
// documents in a hidden browser of the shell's own (research R1). One job at a time, in order;
// everything below runs on the CEF UI thread except print() and cancel(), which post to it.

#include "print_service_cef.h"

#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/cef_task.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_browser_view_delegate.h"
#include "include/views/cef_window.h"
#include "include/views/cef_window_delegate.h"
#include "include/wrapper/cef_helpers.h"

#include <mfbe/utf8_paths.hpp>

#include <deque>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <system_error>
#include <utility>

namespace mfbe::shell {
namespace {

// The paged document sets this title once its fonts are ready (the core's print route adds the
// script; the journeys' fixture waits for the same title).
constexpr const char* kReadyTitle = "mfbe-print-ready";
constexpr const char* kBlank = "about:blank";

class FunctionTask : public CefTask {
public:
    explicit FunctionTask(std::function<void()> fn) : fn_(std::move(fn)) {}
    void Execute() override { fn_(); }

private:
    std::function<void()> fn_;
    IMPLEMENT_REFCOUNTING(FunctionTask);
};

void post_ui(std::function<void()> fn) {
    CefPostTask(TID_UI, new FunctionTask(std::move(fn)));
}

struct Job {
    mfbe::PrintRequest request;
    mfbe::PrintDone done;
    bool printing = false;
    bool cancelled = false;
};

class Printer;

class PrintClient : public CefClient,
                    public CefDisplayHandler,
                    public CefLifeSpanHandler,
                    public CefLoadHandler,
                    public CefRequestHandler {
public:
    explicit PrintClient(Printer* owner) : owner_(owner) {}
    PrintClient(const PrintClient&) = delete;
    PrintClient& operator=(const PrintClient&) = delete;

    CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
    CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
    CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
    CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
    // CEF 150 asks the browser's client for the print handler; on Linux PrintToPDF needs its
    // GetPdfPaperSize (cef_client.h).
    CefRefPtr<CefPrintHandler> GetPrintHandler() override;

    void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override;
    bool OnBeforePopup(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, int, const CefString&,
                       const CefString&, cef_window_open_disposition_t, bool,
                       const CefPopupFeatures&, CefWindowInfo&, CefRefPtr<CefClient>&,
                       CefBrowserSettings&, CefRefPtr<CefDictionaryValue>&, bool*) override {
        return true;  // the print browser opens nothing
    }
    void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
    void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;
    void OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode error_code,
                     const CefString& error_text, const CefString& failed_url) override;
    bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                        CefRefPtr<CefRequest> request, bool user_gesture,
                        bool is_redirect) override;

private:
    Printer* owner_;
    IMPLEMENT_REFCOUNTING(PrintClient);
};

class PrintBrowserViewDelegate : public CefBrowserViewDelegate {
public:
    PrintBrowserViewDelegate() = default;
    PrintBrowserViewDelegate(const PrintBrowserViewDelegate&) = delete;
    PrintBrowserViewDelegate& operator=(const PrintBrowserViewDelegate&) = delete;
    ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView>) override {
        return CEF_CTT_NONE;
    }

private:
    IMPLEMENT_REFCOUNTING(PrintBrowserViewDelegate);
};

// The window holding the print browser; it is never shown.
class HiddenWindowDelegate : public CefWindowDelegate {
public:
    explicit HiddenWindowDelegate(CefRefPtr<CefBrowserView> view) : view_(std::move(view)) {}
    HiddenWindowDelegate(const HiddenWindowDelegate&) = delete;
    HiddenWindowDelegate& operator=(const HiddenWindowDelegate&) = delete;
    void OnWindowCreated(CefRefPtr<CefWindow> window) override { window->AddChildView(view_); }
    void OnWindowDestroyed(CefRefPtr<CefWindow>) override { view_ = nullptr; }
    CefSize GetPreferredSize(CefRefPtr<CefView>) override { return CefSize(800, 1000); }
    bool CanClose(CefRefPtr<CefWindow>) override { return true; }

private:
    CefRefPtr<CefBrowserView> view_;
    IMPLEMENT_REFCOUNTING(HiddenWindowDelegate);
};

class PdfDone : public CefPdfPrintCallback {
public:
    explicit PdfDone(Printer* owner) : owner_(owner) {}
    void OnPdfPrintFinished(const CefString& path, bool ok) override;

private:
    Printer* owner_;
    IMPLEMENT_REFCOUNTING(PdfDone);
};

class Printer final : public mfbe::PrintService {
public:
    /// The editor is closing, its last window gone: the jobs left fail, and the print browser
    /// and its hidden window close, so that CefShutdown finds no browser. CEF requires that; with
    /// the print browser left open, the process and its helpers stayed after the editor's
    /// windows had closed (requester, Windows, rc.4). `done` runs once it has closed, or at once
    /// when there is none.
    void close(std::function<void()> done) {
        CEF_REQUIRE_UI_THREAD();
        while (!queue_.empty()) {
            Job job = std::move(queue_.front());
            queue_.pop_front();
            job.done(false, "the editor is closing");
        }
        if (!view_ && !browser_) {
            done();
            return;
        }
        closed_ = std::move(done);
        if (browser_)
            browser_->GetHost()->CloseBrowser(true);  // else browser_created() closes it
    }

    void browser_closed() {
        CefRefPtr<CefWindow> window = view_ ? view_->GetWindow() : nullptr;
        browser_ = nullptr;
        view_ = nullptr;
        if (window)
            window->Close();
        if (closed_) {
            std::function<void()> done = std::move(closed_);
            closed_ = nullptr;
            done();
        }
    }

    void print(const mfbe::PrintRequest& request, mfbe::PrintDone done) override {
        post_ui([this, request, done = std::move(done)]() mutable {
            queue_.push_back(Job{request, std::move(done)});
            start_next();
        });
    }

    void cancel() override {
        post_ui([this] {
            for (auto it = queue_.begin(); it != queue_.end();) {
                if (it->printing) {
                    it->cancelled = true;  // PrintToPDF cannot be stopped; its file is dropped
                    ++it;
                    continue;
                }
                const bool current = it == queue_.begin();
                mfbe::PrintDone done = std::move(it->done);
                it = queue_.erase(it);
                if (current && browser_)
                    browser_->GetMainFrame()->LoadURL(kBlank);
                done(false, "cancelled");
            }
            start_next();
        });
    }

    // GetPdfPaperSize (Linux): the size of the job being printed.
    CefSize paper_size(int device_units_per_inch) const {
        std::lock_guard lock(paper_mutex_);
        return CefSize(static_cast<int>(paper_width_in_ * device_units_per_inch + 0.5),
                       static_cast<int>(paper_height_in_ * device_units_per_inch + 0.5));
    }

    // --- UI thread ----------------------------------------------------------------------------

    void browser_created(CefRefPtr<CefBrowser> browser) {
        browser_ = std::move(browser);
        if (closed_) {  // the editor closed while the print browser was being created
            browser_->GetHost()->CloseBrowser(true);
            return;
        }
        load_current();
    }

    bool allowed(const std::string& url) const {
        return url == kBlank || (!queue_.empty() && url == queue_.front().request.url);
    }

    void title_changed(CefRefPtr<CefBrowser> browser, const std::string& title) {
        if (title != kReadyTitle || queue_.empty() || queue_.front().printing)
            return;
        Job& job = queue_.front();
        job.printing = true;
        {
            std::lock_guard lock(paper_mutex_);
            paper_width_in_ = job.request.paper_width_in;
            paper_height_in_ = job.request.paper_height_in;
        }
        CefPdfPrintSettings settings;
        settings.paper_width = job.request.paper_width_in;
        settings.paper_height = job.request.paper_height_in;
        settings.margin_type = PDF_PRINT_MARGIN_NONE;
        settings.prefer_css_page_size = 1;
        settings.print_background = 1;
        settings.display_header_footer = 0;
        settings.generate_tagged_pdf = 1;
        settings.generate_document_outline = 0;  // the core builds the bookmarks (D17)
        browser->GetHost()->PrintToPDF(mfbe::platform::utf8_from_path(job.request.out), settings,
                                       new PdfDone(this));
    }

    void load_failed(const std::string& message) {
        if (queue_.empty() || queue_.front().printing)
            return;
        finish(false, "the paged document did not load: " + message);
    }

    void printed(bool ok) {
        if (queue_.empty())
            return;
        if (queue_.front().cancelled) {
            std::error_code ec;
            std::filesystem::remove(queue_.front().request.out, ec);
            finish(false, "cancelled");
        } else {
            finish(ok, ok ? "" : "the browser engine could not print the document");
        }
    }

private:
    void start_next() {
        if (queue_.empty())
            return;
        if (!view_) {
            CefBrowserSettings settings;
            view_ =
                CefBrowserView::CreateBrowserView(new PrintClient(this), kBlank, settings, nullptr,
                                                  nullptr, new PrintBrowserViewDelegate());
            if (!view_) {
                finish(false, "the print browser could not be created");
                return;
            }
            CefWindow::CreateTopLevelWindow(new HiddenWindowDelegate(view_));
            return;  // browser_created() loads the job
        }
        load_current();
    }

    void load_current() {
        if (!browser_ || queue_.empty() || queue_.front().printing)
            return;
        browser_->GetMainFrame()->LoadURL(queue_.front().request.url);
    }

    void finish(bool ok, const std::string& message) {
        Job job = std::move(queue_.front());
        queue_.pop_front();
        if (browser_)
            browser_->GetMainFrame()->LoadURL(kBlank);  // frees the document's memory
        job.done(ok, message);
        start_next();
    }

    std::deque<Job> queue_;  // UI thread only
    CefRefPtr<CefBrowserView> view_;
    CefRefPtr<CefBrowser> browser_;
    std::function<void()> closed_;  // the editor is closing: what to do once the browser has gone
    mutable std::mutex paper_mutex_;
    double paper_width_in_ = 8.27;
    double paper_height_in_ = 11.69;
};

void PrintClient::OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) {
    CEF_REQUIRE_UI_THREAD();
    owner_->title_changed(browser, title.ToString());
}

void PrintClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
    CEF_REQUIRE_UI_THREAD();
    owner_->browser_created(browser);
}

void PrintClient::OnBeforeClose(CefRefPtr<CefBrowser>) {
    CEF_REQUIRE_UI_THREAD();
    owner_->browser_closed();
}

void PrintClient::OnLoadError(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame,
                              ErrorCode error_code, const CefString& error_text, const CefString&) {
    CEF_REQUIRE_UI_THREAD();
    if (frame->IsMain() && error_code != ERR_ABORTED)
        owner_->load_failed(error_text.ToString());
}

bool PrintClient::OnBeforeBrowse(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>,
                                 CefRefPtr<CefRequest> request, bool, bool) {
    CEF_REQUIRE_UI_THREAD();
    return !owner_->allowed(request->GetURL().ToString());  // true cancels the navigation
}

void PdfDone::OnPdfPrintFinished(const CefString&, bool ok) {
    CEF_REQUIRE_UI_THREAD();
    owner_->printed(ok);
}

class PrintHandler : public CefPrintHandler {
public:
    void OnPrintStart(CefRefPtr<CefBrowser>) override {}
    void OnPrintSettings(CefRefPtr<CefBrowser>, CefRefPtr<CefPrintSettings>, bool) override {}
    bool OnPrintDialog(CefRefPtr<CefBrowser>, bool, CefRefPtr<CefPrintDialogCallback>) override {
        return false;
    }
    bool OnPrintJob(CefRefPtr<CefBrowser>, const CefString&, const CefString&,
                    CefRefPtr<CefPrintJobCallback>) override {
        return false;
    }
    void OnPrintReset(CefRefPtr<CefBrowser>) override {}
    CefSize GetPdfPaperSize(CefRefPtr<CefBrowser>, int device_units_per_inch) override;

private:
    IMPLEMENT_REFCOUNTING(PrintHandler);
};

std::shared_ptr<Printer> printer_instance() {
    static const std::shared_ptr<Printer> printer = std::make_shared<Printer>();
    return printer;
}

CefSize PrintHandler::GetPdfPaperSize(CefRefPtr<CefBrowser>, int device_units_per_inch) {
    return printer_instance()->paper_size(device_units_per_inch);
}

CefRefPtr<CefPrintHandler> PrintClient::GetPrintHandler() {
    return printHandler();
}

}  // namespace

std::shared_ptr<mfbe::PrintService> cefPrintService() {
    return printer_instance();
}

CefRefPtr<CefPrintHandler> printHandler() {
    static CefRefPtr<CefPrintHandler> handler = new PrintHandler();
    return handler;
}

void closePrintBrowser(std::function<void()> done) {
    printer_instance()->close(std::move(done));
}

}  // namespace mfbe::shell
