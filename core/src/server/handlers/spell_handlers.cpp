// spell.* handlers (T086) - contracts/rpc-api.md §3.4.
//
//   spell.dictionaries() -> [{tag, lang, name, path, dicPath, readmePath?, source}]
//   spell.dictionaryReport() -> {dictionaries: [as above], rejected: [{path, reason, detail?}],
//                               folders: [{layer, path, exists, readable, writable}]}
//        (feature 003 US4: refreshes the layers and the registry first, so dictionaries copied
//        into a folder are picked up on Settings apply without a restart; `spell.dictionaries`
//        does the same and returns the first part only)
//   spell.dictionaryLicense({tag}) -> {tag, text}      (readme/licence text for About)
//   spell.check({words: string[], langs: string[]}) -> {misspelled: string[], langs: string[]}
//        error 1020 spell.dictionaryUnavailable {lang} when no language has a dictionary
//   spell.suggest({word, langs, max?}) -> {suggestions: string[]}   (max 10 by default)
//   spell.addWord({word}) -> {added: bool, words: string[]}     (1040-style invalidParams on
//                                                              an invalid word)
//   spell.removeWord({word}) -> {removed: bool, words: string[]}
//   spell.customWords() -> string[]
//   spell.customDictionaryPath({path?}) -> {path}   (sets view.customDictionaryPath, reloads)
#include "server/services.hpp"

#include <mfbe/log.hpp>

#include <fstream>

namespace mfbe::server {
namespace {

using nlohmann::json;

constexpr std::size_t kMaxBatch = 200000;
constexpr std::size_t kMaxSuggestions = 50;

spell::SpellService& service(Services& services) {
    if (!services.spell) {
        throw rpc::internal_error("spell service not initialised");
    }
    return *services.spell;
}

rpc::RpcError unavailable(const spell::SpellError& e) {
    return rpc::RpcError(rpc::codes::kSpellDictionaryUnavailable, "",
                         json{{"lang", e.lang}, {"reason", e.reason}});
}

std::vector<std::string> words_param(const json& params, const char* name) {
    const json* field = rpc::params::opt_field(params, name);
    if (field == nullptr) {
        throw rpc::invalid_params(std::string(name) + " is required", json{{"field", name}});
    }
    if (!field->is_array()) {
        throw rpc::invalid_params(std::string(name) + " must be an array of strings",
                                  json{{"field", name}});
    }
    if (field->size() > kMaxBatch) {
        throw rpc::invalid_params(std::string(name) + " has too many items",
                                  json{{"field", name}, {"max", kMaxBatch}});
    }
    std::vector<std::string> out;
    out.reserve(field->size());
    for (const json& item : *field) {
        if (!item.is_string()) {
            throw rpc::invalid_params(std::string(name) + " must be an array of strings",
                                      json{{"field", name}});
        }
        out.push_back(item.get<std::string>());
    }
    return out;
}

}  // namespace

void register_spell_handlers(rpc::RpcRouter& router, Services& services) {
    router.add_method("spell.dictionaries", [&services](const json&, rpc::RpcContext&) {
        spell::SpellService& s = service(services);
        services.refresh_layers();
        s.refresh_dictionaries();
        return s.registry().to_json();
    });

    router.add_method("spell.dictionaryReport", [&services](const json&, rpc::RpcContext&) {
        spell::SpellService& s = service(services);
        services.refresh_layers();
        s.refresh_dictionaries();
        return s.registry().report_json();
    });

    router.add_method("spell.dictionaryLicense", [&services](const json& params, rpc::RpcContext&) {
        spell::SpellService& s = service(services);
        const std::string tag = rpc::params::string(params, "tag");
        for (const spell::Dictionary& d : s.registry().dictionaries()) {
            if (d.tag != tag) {
                continue;
            }
            json result{{"tag", tag}, {"text", ""}};
            if (d.readme) {
                std::ifstream in(*d.readme, std::ios::binary);
                result["text"] = std::string((std::istreambuf_iterator<char>(in)),
                                             std::istreambuf_iterator<char>());
                result["path"] = platform::utf8_from_path(*d.readme);
            }
            return result;
        }
        throw rpc::RpcError(rpc::codes::kSpellDictionaryUnavailable, "",
                            json{{"lang", tag}, {"reason", "unknown dictionary"}});
    });

    router.add_method("spell.check", [&services](const json& params, rpc::RpcContext&) {
        spell::SpellService& s = service(services);
        const std::vector<std::string> words = words_param(params, "words");
        const std::vector<std::string> langs = rpc::params::string_array_or(params, "langs");
        try {
            const spell::CheckResult result = s.check(words, langs);
            return json{{"misspelled", result.misspelled}, {"langs", result.langs}};
        } catch (const spell::SpellError& e) {
            throw unavailable(e);
        }
    });

    router.add_method("spell.suggest", [&services](const json& params, rpc::RpcContext&) {
        spell::SpellService& s = service(services);
        const std::string word = rpc::params::string(params, "word");
        const std::vector<std::string> langs = rpc::params::string_array_or(params, "langs");
        const int max = rpc::params::integer_or(params, "max", 10);
        if (max < 1 || static_cast<std::size_t>(max) > kMaxSuggestions) {
            throw rpc::invalid_params("max must be between 1 and 50", json{{"field", "max"}});
        }
        try {
            return json{{"suggestions", s.suggest(word, langs, static_cast<std::size_t>(max))}};
        } catch (const spell::SpellError& e) {
            throw unavailable(e);
        }
    });

    router.add_method("spell.addWord", [&services](const json& params, rpc::RpcContext&) {
        spell::SpellService& s = service(services);
        const std::string word = rpc::params::string(params, "word");
        const std::string error = s.add_word(word);
        if (!error.empty() && error != "duplicate") {
            throw rpc::invalid_params("invalid word: " + error,
                                      json{{"field", "word"}, {"reason", error}});
        }
        return json{{"added", error.empty()}, {"words", s.custom().words()}};
    });

    router.add_method("spell.removeWord", [&services](const json& params, rpc::RpcContext&) {
        spell::SpellService& s = service(services);
        const std::string word = rpc::params::string(params, "word");
        const bool removed = s.remove_word(word);
        return json{{"removed", removed}, {"words", s.custom().words()}};
    });

    router.add_method("spell.customWords", [&services](const json&, rpc::RpcContext&) {
        return json(service(services).custom().words());
    });

    router.add_method(
        "spell.customDictionaryPath", [&services](const json& params, rpc::RpcContext& ctx) {
            spell::SpellService& s = service(services);
            if (const auto path = rpc::params::opt_string(params, "path")) {
                std::filesystem::path target = platform::path_from_utf8(*path);
                if (target.empty()) {
                    target = services.dirs.data / "custom.dic";
                } else {
                    std::error_code ec;
                    target = std::filesystem::absolute(target, ec);
                }
                const auto result = services.settings.apply_patch(
                    json{{"view",
                          {{"customDictionaryPath",
                            path->empty() ? "" : platform::utf8_from_path(target)}}}});
                ctx.notifier.notify("settings.changed", json{{"settings", result.settings}});
                s.set_custom_path(target);
            }
            return json{{"path", platform::utf8_from_path(s.custom().path())}};
        });
}

}  // namespace mfbe::server
