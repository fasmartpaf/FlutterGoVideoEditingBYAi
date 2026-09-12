/**
 * Which chat providers can receive OpenScreen-attached JPEG frames on the
 * normal LangChain HumanMessage path (OpenAI-style `image_url` parts, which
 * ChatAnthropic also accepts and remaps).
 *
 * local-cli shells a text prompt — images are NOT attached by OpenScreen
 * (subprocess may still ffmpeg on its own; that does not set visualFrames).
 * MiniMax rides ChatAnthropic but image support is unproven → leave false.
 */

const SUPPORTED = new Set([
	"anthropic",
	"openai",
	"google",
	"openrouter",
	"mistral",
	"openai-compatible",
]);

export function providerSupportsAttachedVisualFrames(provider: string): boolean {
	return SUPPORTED.has(provider.trim().toLowerCase());
}
