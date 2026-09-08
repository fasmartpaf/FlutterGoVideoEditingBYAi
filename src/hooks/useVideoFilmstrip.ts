import { useEffect, useState } from "react";

const cache = new Map<string, string[]>();

function cacheKey(url: string, times: number[]): string {
	return `${url}|${times.map((t) => t.toFixed(2)).join(",")}`;
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onSeeked = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("seek failed"));
		};
		const cleanup = () => {
			video.removeEventListener("seeked", onSeeked);
			video.removeEventListener("error", onError);
		};
		video.addEventListener("seeked", onSeeked);
		video.addEventListener("error", onError);
		try {
			video.currentTime = Math.max(0, timeSec);
		} catch (err) {
			cleanup();
			reject(err instanceof Error ? err : new Error(String(err)));
		}
	});
}

function grabFrame(video: HTMLVideoElement): string | null {
	const width = video.videoWidth;
	const height = video.videoHeight;
	if (!width || !height) return null;
	const maxH = 48;
	const scale = maxH / height;
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = maxH;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
	try {
		return canvas.toDataURL("image/jpeg", 0.62);
	} catch {
		return null;
	}
}

/**
 * Pictures for a timeline card. One hidden video seeks through `times` and
 * caches JPEG stills so later mounts of the same span do not re-decode.
 */
export function useVideoFilmstrip(url: string | undefined, times: number[]): string[] {
	const key = url && times.length > 0 ? cacheKey(url, times) : "";
	const [frames, setFrames] = useState<string[]>(() => (key ? (cache.get(key) ?? []) : []));

	useEffect(() => {
		if (!url || times.length === 0 || typeof document === "undefined") {
			setFrames([]);
			return;
		}
		const hit = cache.get(key);
		if (hit) {
			setFrames(hit);
			return;
		}
		let cancelled = false;
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";
		video.src = url;

		const run = async () => {
			await new Promise<void>((resolve, reject) => {
				const onReady = () => {
					video.removeEventListener("loadeddata", onReady);
					video.removeEventListener("error", onError);
					resolve();
				};
				const onError = () => {
					video.removeEventListener("loadeddata", onReady);
					video.removeEventListener("error", onError);
					reject(new Error("video load failed"));
				};
				video.addEventListener("loadeddata", onReady);
				video.addEventListener("error", onError);
			});
			const grabbed: string[] = [];
			for (const time of times) {
				if (cancelled) return;
				try {
					await seekVideo(video, time);
					const frame = grabFrame(video);
					if (frame) grabbed.push(frame);
				} catch {
					/* a single failed seek leaves a gap, not an empty strip */
				}
			}
			if (cancelled || grabbed.length === 0) return;
			cache.set(key, grabbed);
			setFrames(grabbed);
		};

		void run().catch(() => {
			if (!cancelled) setFrames([]);
		});
		return () => {
			cancelled = true;
			video.removeAttribute("src");
			video.load();
		};
	}, [key, times, url]);

	return frames;
}
