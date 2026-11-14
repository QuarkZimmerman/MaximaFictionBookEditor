#pragma once
// Feature 014 (contracts/print-service.md, plan DP-12, tasks T012): the shell's print service for
// the PDF export. The core asks it to print a paged document it serves; the shell loads that page
// in a hidden browser of its own and prints it with CefBrowserHost::PrintToPDF. The editor's
// window is never printed, and the hidden browser loads nothing but the job's own address.

#include "include/cef_print_handler.h"

#include <mfbe/print_service.hpp>

#include <functional>
#include <memory>

namespace mfbe::shell {

/// The one print service of the process (created on first call).
std::shared_ptr<mfbe::PrintService> cefPrintService();

/// The print browser's CefClient::GetPrintHandler: on Linux, PrintToPDF needs GetPdfPaperSize,
/// which answers with the size of the job being printed.
CefRefPtr<CefPrintHandler> printHandler();

/// The editor is closing (its last window has gone): the print jobs left fail, and the hidden
/// print browser closes; `done` runs once it has (at once when there is none). CefShutdown must
/// find no browser open, else the process and its helpers stay (UI thread).
void closePrintBrowser(std::function<void()> done);

}  // namespace mfbe::shell
