import { memo } from "react";
import { useVideoFilmstrip } from "@/hooks/useVideoFilmstrip";
import styles from "./EditorShellV4.module.css";

export const ClipFilmstrip = memo(function ClipFilmstrip({
	url,
	times,
	className,
}: {
	url: string | undefined;
	times: number[];
	className: string;
}) {
	const frames = useVideoFilmstrip(url, times);
	if (frames.length === 0) return null;
	return (
		<div aria-hidden className={className}>
			{frames.map((src, i) => (
				<img key={`${i}-${src.slice(-12)}`} src={src} alt="" />
			))}
		</div>
	);
});
