/**
 * Cursor-style Level-1 labels for OpenScreen / CLI tool activity.
 * Keep paths, IDs, and receipts out of these strings.
 */

const OPENSCREEN_STATUS: Record<string, string> = {
	getCurrentDocument: "Reading project",
	listSources: "Listing sources",
	listTransitions: "Listing transitions",
	getTranscript: "Reading transcript",
	getTranscriptWords: "Reading transcript",
	getTranscriptRange: "Reading transcript",
	getCursorTrack: "Reading cursor track",
	listCharacters: "Listing characters",
	updatePlan: "Updating plan",
	addTrim: "Cutting a section",
	addTrims: "Cutting sections",
	setTrim: "Adjusting a cut",
	removeTrim: "Restoring a cut",
	removeFillerWords: "Removing filler words",
	setClipRange: "Trimming a clip",
	addClip: "Adding a clip",
	moveClip: "Reordering clips",
	replaceTimeline: "Rebuilding the timeline",
	setClipCrop: "Cropping a clip",
	removeClip: "Removing a clip",
	splitClip: "Splitting a clip",
	duplicateClip: "Duplicating a clip",
	reorderClips: "Reordering clips",
	addZooms: "Adding zooms",
	setZoom: "Adjusting a zoom",
	setSpeed: "Adjusting speed",
	setAnnotation: "Editing an overlay",
	addCameraFullscreen: "Framing the webcam",
	setCameraFullscreen: "Framing the webcam",
	setAspectRatio: "Changing aspect ratio",
	importMedia: "Importing media",
	insertStartThumbnail: "Updating start cover",
	addGraphic: "Editing graphics",
	addAnnotation: "Editing graphics",
	addBeatGraphics: "Creating beat graphics",
	createMotionGraphicPreview: "Creating animation",
	createMotionClip: "Rendering a motion graphic",
	placeMotionClip: "Placing a motion graphic",
	addMotionOverlay: "Animating an overlay",
	sampleFrames: "Checking frames",
	listCursorThemes: "Reading cursor styles",
	getVideoSummary: "Reading the video summary",
	listMotionTemplates: "Listing motion templates",
	setBrandKit: "Updating brand kit",
	removeModifier: "Cleaning timeline",
	removeAnnotation: "Cleaning timeline",
	removeGraphic: "Cleaning timeline",
	addZoom: "Adding a zoom",
	updateZoom: "Adjusting a zoom",
	removeZoom: "Cleaning timeline",
	addSpeed: "Changing speed",
	tightenPacing: "Tightening pauses",
	addCursorHighlight: "Editing cursor highlight",
	removeCursorHighlight: "Cleaning timeline",
	addPrivacyCover: "Adding privacy cover",
	removePrivacyCover: "Cleaning timeline",
	setBackground: "Updating look",
	setEditorSettings: "Updating settings",
	setCaptionSettings: "Updating captions",
	generateCaptions: "Generating captions",
	setWordText: "Updating captions",
	addAudio: "Editing audio",
	setAudio: "Editing audio",
	setClipIncomingTransition: "Editing transitions",
	registerCharacter: "Registering character",
	exportProject: "Exporting",
	createShowcaseVideo: "Making the showcase video",
	record: "Recording",
	recordScreen: "Recording the screen",
};

const CLI_STATUS: Record<string, string> = {
	Read: "Reading files",
	Write: "Writing files",
	Edit: "Editing files",
	Bash: "Using Bash",
	Glob: "Searching files",
	Grep: "Searching files",
	Shell: "Using Bash",
	run_terminal_cmd: "Using Bash",
	read_file: "Reading files",
	write_file: "Writing files",
	search_replace: "Editing files",
	grep: "Searching files",
	glob_file_search: "Searching files",
};

/** Short Level-1 status for live progress / activity rows. */
export function toolActivityStatus(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return "Working";
	if (OPENSCREEN_STATUS[trimmed]) return OPENSCREEN_STATUS[trimmed];
	if (CLI_STATUS[trimmed]) return CLI_STATUS[trimmed];
	const lower = trimmed.toLowerCase();
	for (const [key, label] of Object.entries(CLI_STATUS)) {
		if (key.toLowerCase() === lower) return label;
	}
	if (/^remove/i.test(trimmed)) return "Cleaning timeline";
	if (/^add|^set|^update|^insert/i.test(trimmed)) return "Editing timeline";
	if (/ffmpeg|render|preview/i.test(trimmed)) return "Rendering preview";
	return `Using ${trimmed}`;
}

/** Progress line ending with ellipsis for stream heartbeats. */
export function toolActivityProgressLine(name: string): string {
	return `${toolActivityStatus(name)}…`;
}
