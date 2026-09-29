/**
 * Which chat providers can receive OpenScreen-attached JPEG frames on the
 * normal LangChain HumanMessage path (OpenAI-style `image_url` parts, which
 * ChatAnthropic also accepts and remaps).
 *
 * local-cli shells a text prompt — images are NOT attached as multimodal parts
 * (see `providerUsesFrameFilePaths` for the JPEG-on-disk path).
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

/** Local CLI agents receive frame *paths* in the text prompt, not image_url parts. */
export function providerUsesFrameFilePaths(provider: string): boolean {
	return provider.trim().toLowerCase() === "local-cli";
}

export function providerSupportsAttachedVisualFrames(provider: string): boolean {
	return SUPPORTED.has(provider.trim().toLowerCase());
}

/** True when OpenScreen should sample frames for this provider (multimodal or path). */
export function providerCanReceiveVisualEvidence(provider: string): boolean {
	const id = provider.trim().toLowerCase();
	return providerSupportsAttachedVisualFrames(id) || providerUsesFrameFilePaths(id);
}
