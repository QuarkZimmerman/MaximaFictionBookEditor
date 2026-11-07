#pragma once

// Feature 010 (D42, FR-127, research DP-17): Anthropic's own interface. Anthropic's
// OpenAI-compatible interface ignores the thinking effort, which only its Messages API takes
// (`output_config.effort`), so for an address on Anthropic's host the core speaks the Messages API.
// These pure functions turn the assistant's OpenAI-style chat completion into a Messages request
// and the Messages answer back into a chat completion: the interface keeps one request form.
// The formats are those of Anthropic's "Create a Message" reference.

#include <nlohmann/json.hpp>

namespace mfbe::ai::anthropic {

/// The output limit asked for when the chat names none: the Messages API requires one, and
/// Anthropic advises against a large one without streaming - 16000 stays below the 10 minutes its
/// own SDK allows a request without streaming.
inline constexpr long long kDefaultMaxTokens = 16000;

/// The Messages request of an OpenAI-style chat completion body: `system` and `developer`
/// messages become `system`; consecutive messages of one role merge; an assistant's `tool_calls`
/// become `tool_use` blocks and `tool` messages `tool_result` blocks of the next user turn, first
/// in it; `tools`, `tool_choice`, `parallel_tool_calls`, `stop`, the token limit, `temperature`,
/// `top_p`, `output_config` and `stream` are carried under Anthropic's names; everything else is
/// left out (the Messages API refuses members it does not know). The request asks for
/// Anthropic's automatic prompt caching (a top-level `cache_control`, D43).
nlohmann::json to_messages_request(const nlohmann::json& chat);

/// The chat-completion form of a Messages answer: the text blocks joined as the message's
/// content, `tool_use` blocks as `tool_calls`, thinking left out, `stop_reason` as
/// `finish_reason`, the usage counted as OpenAI does. Anything that is not a Messages answer - an
/// error body among others, whose `error.message` both forms share - is returned as it is.
nlohmann::json to_chat_completion(const nlohmann::json& message);

}  // namespace mfbe::ai::anthropic
