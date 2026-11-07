// Feature 010 (D42, FR-127, research DP-17): the chat completion <-> Messages translation of
// Anthropic's own interface, against the formats of Anthropic's "Create a Message" reference.
// Test names are plain ASCII without commas: ctest hands them to Catch2 as filters.

#include <mfbe/anthropic_messages.hpp>

#include <nlohmann/json.hpp>

#include <catch2/catch_test_macros.hpp>
#include <utility>

using nlohmann::json;
namespace anthropic = mfbe::ai::anthropic;

TEST_CASE("anthropic messages: a chat with system text and tools becomes a Messages request",
          "[ai][anthropic]") {
    const json chat{
        {"model", "claude-test"},
        {"stream", false},
        {"messages", json::array({json{{"role", "system"}, {"content", "You edit books."}},
                                  json{{"role", "developer"}, {"content", "Be brief."}},
                                  json{{"role", "user"}, {"content", "Make it bold."}}})},
        {"tools",
         json::array(
             {json{{"type", "function"},
                   {"function",
                    {{"name", "read"},
                     {"description", "Reads the book."},
                     {"parameters",
                      {{"type", "object"}, {"properties", {{"what", {{"type", "string"}}}}}}}}}},
              json{{"type", "function"}, {"function", {{"name", "count"}}}}})},
        {"tool_choice", "auto"},
        {"output_config", {{"effort", "high"}}},
        {"api_key", "opaque"},
        {"reasoning_effort", "high"},
        {"n", 1}};
    const json request = anthropic::to_messages_request(chat);
    CHECK(request["model"] == "claude-test");
    CHECK(request["max_tokens"] == anthropic::kDefaultMaxTokens);
    CHECK(request["stream"] == false);
    CHECK(request["system"] == json::array({json{{"type", "text"}, {"text", "You edit books."}},
                                            json{{"type", "text"}, {"text", "Be brief."}}}));
    CHECK(request["messages"] ==
          json::array({json{
              {"role", "user"},
              {"content", json::array({json{{"type", "text"}, {"text", "Make it bold."}}})}}}));
    REQUIRE(request["tools"].size() == 2);
    CHECK(request["tools"][0] ==
          json{{"name", "read"},
               {"description", "Reads the book."},
               {"input_schema",
                {{"type", "object"}, {"properties", {{"what", {{"type", "string"}}}}}}}});
    CHECK(request["tools"][1] == json{{"name", "count"}, {"input_schema", {{"type", "object"}}}});
    CHECK(request["tool_choice"] == json{{"type", "auto"}});
    CHECK(request["output_config"] == json{{"effort", "high"}});
    // D43: Anthropic's automatic prompt caching, one top-level marker.
    CHECK(request["cache_control"] == json{{"type", "ephemeral"}});
    // Members the Messages API does not know are left out.
    CHECK_FALSE(request.contains("api_key"));
    CHECK_FALSE(request.contains("reasoning_effort"));
    CHECK_FALSE(request.contains("n"));
}

TEST_CASE("anthropic messages: tool calls and their results keep their turns with results first",
          "[ai][anthropic]") {
    const json chat{
        {"model", "claude-test"},
        {"messages",
         json::array(
             {json{{"role", "user"}, {"content", "Count the sections."}},
              json{{"role", "user"}, {"content", "And the notes."}},
              json{{"role", "assistant"},
                   {"content", "Counting."},
                   {"tool_calls",
                    json::array(
                        {json{{"id", "call_1"},
                              {"type", "function"},
                              {"function",
                               {{"name", "count"}, {"arguments", R"({"what":"sections"})"}}}},
                         json{{"id", "call_2"},
                              {"type", "function"},
                              {"function", {{"name", "count"}, {"arguments", "not json"}}}}})}},
              json{{"role", "tool"}, {"tool_call_id", "call_1"}, {"content", "12"}},
              json{{"role", "tool"},
                   {"tool_call_id", "call_2"},
                   {"content", json::array({json{{"type", "text"}, {"text", "3"}}})}},
              json{{"role", "user"}, {"content", "Thanks."}},
              json{{"role", "assistant"}, {"content", nullptr}}})}};
    const json messages = anthropic::to_messages_request(chat)["messages"];
    REQUIRE(messages.size() == 3);
    // Two user messages in a row are one turn.
    CHECK(messages[0]["role"] == "user");
    CHECK(messages[0]["content"].size() == 2);
    // The assistant's text, then its calls with their arguments parsed (invalid ones empty).
    CHECK(messages[1] ==
          json{{"role", "assistant"},
               {"content", json::array({json{{"type", "text"}, {"text", "Counting."}},
                                        json{{"type", "tool_use"},
                                             {"id", "call_1"},
                                             {"name", "count"},
                                             {"input", {{"what", "sections"}}}},
                                        json{{"type", "tool_use"},
                                             {"id", "call_2"},
                                             {"name", "count"},
                                             {"input", json::object()}}})}});
    // The results, first in the next user turn, then the user's own text; an empty assistant
    // message adds nothing.
    CHECK(messages[2] ==
          json{{"role", "user"},
               {"content",
                json::array(
                    {json{{"type", "tool_result"}, {"tool_use_id", "call_1"}, {"content", "12"}},
                     json{{"type", "tool_result"}, {"tool_use_id", "call_2"}, {"content", "3"}},
                     json{{"type", "text"}, {"text", "Thanks."}}})}});
}

TEST_CASE("anthropic messages: limits and stop sequences and tool choices and pictures",
          "[ai][anthropic]") {
    json chat{
        {"model", "claude-test"},
        {"max_completion_tokens", 512},
        {"max_tokens", 9000},
        {"stop", "END"},
        {"temperature", 0.2},
        {"tools", json::array({json{{"type", "function"}, {"function", {{"name", "a"}}}}})},
        {"tool_choice", "required"},
        {"parallel_tool_calls", false},
        {"messages",
         json::array({json{
             {"role", "user"},
             {"content",
              json::array({json{{"type", "text"}, {"text", ""}},
                           json{{"type", "text"}, {"text", "Describe these."}},
                           json{{"type", "image_url"},
                                {"image_url", {{"url", "data:image/png;base64,iVBORw0K"}}}},
                           json{{"type", "image_url"},
                                {"image_url", {{"url", "https://example.com/a.jpg"}}}}})}}})}};
    json request = anthropic::to_messages_request(chat);
    CHECK(request["max_tokens"] == 512);  // max_completion_tokens first
    CHECK(request["stop_sequences"] == json::array({"END"}));
    CHECK(request["temperature"] == 0.2);
    CHECK(request["tool_choice"] == json{{"type", "any"}, {"disable_parallel_tool_use", true}});
    CHECK(request["messages"][0]["content"] ==
          json::array(
              {json{{"type", "text"}, {"text", "Describe these."}},
               json{{"type", "image"},
                    {"source",
                     {{"type", "base64"}, {"media_type", "image/png"}, {"data", "iVBORw0K"}}}},
               json{{"type", "image"},
                    {"source", {{"type", "url"}, {"url", "https://example.com/a.jpg"}}}}}));

    chat.erase("max_completion_tokens");
    chat["stop"] = json::array({"A", "B"});
    chat["tool_choice"] = json{{"type", "function"}, {"function", {{"name", "a"}}}};
    chat.erase("parallel_tool_calls");
    request = anthropic::to_messages_request(chat);
    CHECK(request["max_tokens"] == 9000);
    CHECK(request["stop_sequences"] == json::array({"A", "B"}));
    CHECK(request["tool_choice"] == json{{"type", "tool"}, {"name", "a"}});

    chat["tool_choice"] = "none";
    CHECK(anthropic::to_messages_request(chat)["tool_choice"] == json{{"type", "none"}});
    // No tools: no tool choice either.
    chat.erase("tools");
    CHECK_FALSE(anthropic::to_messages_request(chat).contains("tool_choice"));
}

TEST_CASE("anthropic messages: an answer becomes a chat completion", "[ai][anthropic]") {
    const json answer{
        {"id", "msg_1"},
        {"type", "message"},
        {"role", "assistant"},
        {"model", "claude-test"},
        {"content",
         json::array({json{{"type", "thinking"}, {"thinking", "Let me see."}, {"signature", "x"}},
                      json{{"type", "text"}, {"text", "Two "}},
                      json{{"type", "text"}, {"text", "sections."}},
                      json{{"type", "tool_use"},
                           {"id", "toolu_1"},
                           {"name", "count"},
                           {"input", {{"what", "notes"}}}}})},
        {"stop_reason", "tool_use"},
        {"usage",
         {{"input_tokens", 10},
          {"output_tokens", 5},
          {"cache_read_input_tokens", 2},
          {"cache_creation_input_tokens", nullptr}}}};
    const json completion = anthropic::to_chat_completion(answer);
    CHECK(completion["id"] == "msg_1");
    CHECK(completion["object"] == "chat.completion");
    CHECK(completion["model"] == "claude-test");
    const json& choice = completion["choices"][0];
    CHECK(choice["index"] == 0);
    CHECK(choice["finish_reason"] == "tool_calls");
    CHECK(choice["message"]["role"] == "assistant");
    CHECK(choice["message"]["content"] == "Two sections.");
    REQUIRE(choice["message"]["tool_calls"].size() == 1);
    CHECK(choice["message"]["tool_calls"][0] ==
          json{{"id", "toolu_1"},
               {"type", "function"},
               {"function", {{"name", "count"}, {"arguments", R"({"what":"notes"})"}}}});
    CHECK(completion["usage"] == json{{"prompt_tokens", 12},
                                      {"completion_tokens", 5},
                                      {"total_tokens", 17},
                                      {"prompt_tokens_details", {{"cached_tokens", 2}}}});

    // Every stop reason of the reference has its finish reason.
    for (const auto& [stop, finish] :
         {std::pair{"end_turn", "stop"}, std::pair{"stop_sequence", "stop"},
          std::pair{"refusal", "stop"}, std::pair{"pause_turn", "stop"},
          std::pair{"max_tokens", "length"}, std::pair{"model_context_window_exceeded", "length"},
          std::pair{"tool_use", "tool_calls"}}) {
        INFO(stop);
        json one = answer;
        one["stop_reason"] = stop;
        CHECK(anthropic::to_chat_completion(one)["choices"][0]["finish_reason"] == finish);
    }

    // Only tool calls: the content is null, as OpenAI's.
    json calls_only = answer;
    calls_only["content"] = json::array({answer["content"][3]});
    CHECK(anthropic::to_chat_completion(calls_only)["choices"][0]["message"]["content"].is_null());

    // An error body - or anything else - stays as it is: both forms keep error.message.
    const json error{{"type", "error"},
                     {"error", {{"type", "invalid_request_error"}, {"message", "bad effort"}}}};
    CHECK(anthropic::to_chat_completion(error) == error);
    CHECK(anthropic::to_chat_completion(json::array()) == json::array());
}
