// Feature 010 (D42, FR-127, research DP-17): the chat completion <-> Messages translation of
// Anthropic's own interface (mfbe/anthropic_messages.hpp).

#include <mfbe/anthropic_messages.hpp>

#include <optional>
#include <string>
#include <utility>

namespace mfbe::ai::anthropic {

using json = nlohmann::json;

namespace {

// A member as a string, "" when absent or not a string.
std::string string_of(const json& object, const char* key) {
    if (!object.is_object())
        return {};
    const auto it = object.find(key);
    return it != object.end() && it->is_string() ? it->get<std::string>() : std::string();
}

// A member as a whole number, 0 when absent, null or not a number.
long long number_of(const json& object, const char* key) {
    if (!object.is_object())
        return 0;
    const auto it = object.find(key);
    return it != object.end() && it->is_number_integer() ? it->get<long long>() : 0;
}

// A member that is an object, an empty object otherwise.
json object_of(const json& object, const char* key) {
    if (!object.is_object())
        return json::object();
    const auto it = object.find(key);
    return it != object.end() && it->is_object() ? *it : json::object();
}

json text_block(std::string text) {
    return json{{"type", "text"}, {"text", std::move(text)}};
}

// The text of an OpenAI content: a string, or the text parts of an array joined.
std::string text_of(const json& content) {
    if (content.is_string())
        return content.get<std::string>();
    std::string text;
    if (content.is_array()) {
        for (const json& part : content) {
            if (string_of(part, "type") == "text")
                text += string_of(part, "text");
        }
    }
    return text;
}

// An OpenAI image part ({type: image_url, image_url: {url}}) as an image block: a `data:` URL
// becomes a base64 source, any other address a url source.
std::optional<json> image_block(const json& part) {
    const json* image = part.contains("image_url") ? &part["image_url"] : nullptr;
    const std::string url = image == nullptr ? std::string()
                                             : (image->is_string() ? image->get<std::string>()
                                                                   : string_of(*image, "url"));
    if (url.empty())
        return std::nullopt;
    if (url.rfind("data:", 0) == 0) {
        const auto semicolon = url.find(';');
        const auto comma = url.find(',');
        if (semicolon == std::string::npos || comma == std::string::npos || semicolon > comma ||
            url.compare(semicolon, 8, ";base64,") != 0) {
            return std::nullopt;
        }
        return json{{"type", "image"},
                    {"source",
                     {{"type", "base64"},
                      {"media_type", url.substr(5, semicolon - 5)},
                      {"data", url.substr(comma + 1)}}}};
    }
    return json{{"type", "image"}, {"source", {{"type", "url"}, {"url", url}}}};
}

// The blocks of a user or system content: text and images; empty text is left out, as the
// Messages API refuses empty text blocks.
json content_blocks(const json& content) {
    json blocks = json::array();
    if (content.is_string()) {
        if (!content.get_ref<const std::string&>().empty())
            blocks.push_back(text_block(content.get<std::string>()));
        return blocks;
    }
    if (!content.is_array())
        return blocks;
    for (const json& part : content) {
        const std::string type = string_of(part, "type");
        if (type == "text") {
            std::string text = string_of(part, "text");
            if (!text.empty())
                blocks.push_back(text_block(std::move(text)));
        } else if (type == "image_url") {
            if (auto block = image_block(part))
                blocks.push_back(std::move(*block));
        }
    }
    return blocks;
}

// A tool call's arguments - a JSON string, or an object some services send - as the tool_use
// block's input object.
json input_of(const json& arguments) {
    if (arguments.is_object())
        return arguments;
    if (arguments.is_string()) {
        json parsed = json::parse(arguments.get<std::string>(), nullptr, false);
        if (parsed.is_object())
            return parsed;
    }
    return json::object();
}

// Appends `blocks` as a turn of `role`, merged into the last turn when it has the same role. Tool
// results go before the other blocks of their user turn: Anthropic's rule (Handle tool calls).
void append(json& messages, const std::string& role, json blocks) {
    if (blocks.empty())
        return;
    if (messages.empty() || string_of(messages.back(), "role") != role) {
        messages.push_back(json{{"role", role}, {"content", std::move(blocks)}});
        return;
    }
    json merged = json::array();
    json& content = messages.back()["content"];
    for (const bool results : {true, false}) {
        for (const json* source : {&content, &blocks}) {
            for (const json& block : *source) {
                if ((string_of(block, "type") == "tool_result") == results)
                    merged.push_back(block);
            }
        }
    }
    content = std::move(merged);
}

json tool_choice_of(const json& chat, bool has_tools) {
    json choice;
    const auto given = chat.find("tool_choice");
    if (given != chat.end()) {
        if (given->is_string()) {
            const std::string value = given->get<std::string>();
            if (value == "auto")
                choice = json{{"type", "auto"}};
            else if (value == "none")
                choice = json{{"type", "none"}};
            else if (value == "required")
                choice = json{{"type", "any"}};
        } else if (string_of(*given, "type") == "function") {
            choice =
                json{{"type", "tool"}, {"name", string_of(object_of(*given, "function"), "name")}};
        }
    }
    const auto parallel = chat.find("parallel_tool_calls");
    if (has_tools && parallel != chat.end() && parallel->is_boolean() && !parallel->get<bool>()) {
        if (choice.is_null())
            choice = json{{"type", "auto"}};
        if (string_of(choice, "type") != "none")
            choice["disable_parallel_tool_use"] = true;
    }
    return choice;
}

}  // namespace

json to_messages_request(const json& chat) {
    json request = json::object();
    if (chat.contains("model"))
        request["model"] = chat["model"];
    long long max_tokens = kDefaultMaxTokens;
    for (const char* key : {"max_completion_tokens", "max_tokens"}) {
        if (const long long given = number_of(chat, key); given > 0) {
            max_tokens = given;
            break;
        }
    }
    request["max_tokens"] = max_tokens;

    json system = json::array();
    json messages = json::array();
    const auto given = chat.find("messages");
    if (given != chat.end() && given->is_array()) {
        for (const json& message : *given) {
            const std::string role = string_of(message, "role");
            const json content =
                message.is_object() && message.contains("content") ? message["content"] : json();
            if (role == "system" || role == "developer") {
                for (json& block : content_blocks(content)) {
                    if (string_of(block, "type") == "text")
                        system.push_back(std::move(block));
                }
            } else if (role == "user") {
                append(messages, "user", content_blocks(content));
            } else if (role == "assistant") {
                json blocks = json::array();
                if (std::string text = text_of(content); !text.empty())
                    blocks.push_back(text_block(std::move(text)));
                const auto calls = message.find("tool_calls");
                if (calls != message.end() && calls->is_array()) {
                    for (const json& call : *calls) {
                        const json function = object_of(call, "function");
                        blocks.push_back(json{{"type", "tool_use"},
                                              {"id", string_of(call, "id")},
                                              {"name", string_of(function, "name")},
                                              {"input", input_of(function.contains("arguments")
                                                                     ? function["arguments"]
                                                                     : json())}});
                    }
                }
                append(messages, "assistant", std::move(blocks));
            } else if (role == "tool") {
                append(messages, "user",
                       json::array({json{{"type", "tool_result"},
                                         {"tool_use_id", string_of(message, "tool_call_id")},
                                         {"content", text_of(content)}}}));
            }
        }
    }
    if (!system.empty())
        request["system"] = std::move(system);
    request["messages"] = std::move(messages);

    const auto tools = chat.find("tools");
    if (tools != chat.end() && tools->is_array() && !tools->empty()) {
        json converted = json::array();
        for (const json& tool : *tools) {
            const json function = object_of(tool, "function");
            json schema = object_of(function, "parameters");
            if (!schema.contains("type"))
                schema["type"] = "object";
            json entry{{"name", string_of(function, "name")}, {"input_schema", std::move(schema)}};
            if (std::string description = string_of(function, "description"); !description.empty())
                entry["description"] = std::move(description);
            converted.push_back(std::move(entry));
        }
        request["tools"] = std::move(converted);
        if (json choice = tool_choice_of(chat, true); !choice.is_null())
            request["tool_choice"] = std::move(choice);
    }

    const auto stop = chat.find("stop");
    if (stop != chat.end()) {
        if (stop->is_string())
            request["stop_sequences"] = json::array({*stop});
        else if (stop->is_array() && !stop->empty())
            request["stop_sequences"] = *stop;
    }
    for (const char* key : {"temperature", "top_p", "output_config", "stream"}) {
        if (const auto it = chat.find(key); it != chat.end())
            request[key] = *it;
    }
    return request;
}

json to_chat_completion(const json& message) {
    if (!message.is_object() || string_of(message, "type") != "message" ||
        !message.contains("content") || !message["content"].is_array()) {
        return message;
    }
    std::string text;
    json calls = json::array();
    for (const json& block : message["content"]) {
        const std::string type = string_of(block, "type");
        if (type == "text") {
            text += string_of(block, "text");
        } else if (type == "tool_use") {
            const json input = block.contains("input") ? block["input"] : json::object();
            calls.push_back(json{
                {"id", string_of(block, "id")},
                {"type", "function"},
                {"function", {{"name", string_of(block, "name")}, {"arguments", input.dump()}}}});
        }
    }
    const std::string stop = string_of(message, "stop_reason");
    const char* finish = "stop";
    if (stop == "max_tokens" || stop == "model_context_window_exceeded")
        finish = "length";
    else if (stop == "tool_use")
        finish = "tool_calls";

    json reply{{"role", "assistant"},
               {"content", text.empty() && !calls.empty() ? json() : json(std::move(text))}};
    if (!calls.empty())
        reply["tool_calls"] = std::move(calls);
    json completion{
        {"id", string_of(message, "id")},
        {"object", "chat.completion"},
        {"model", string_of(message, "model")},
        {"choices", json::array({json{
                        {"index", 0}, {"message", std::move(reply)}, {"finish_reason", finish}}})}};
    if (const auto usage = message.find("usage"); usage != message.end() && usage->is_object()) {
        const long long prompt = number_of(*usage, "input_tokens") +
                                 number_of(*usage, "cache_read_input_tokens") +
                                 number_of(*usage, "cache_creation_input_tokens");
        const long long generated = number_of(*usage, "output_tokens");
        completion["usage"] = json{{"prompt_tokens", prompt},
                                   {"completion_tokens", generated},
                                   {"total_tokens", prompt + generated}};
    }
    return completion;
}

}  // namespace mfbe::ai::anthropic
