import { useEffect } from "react";
import { useTimeMachine } from "../../hooks/use-time-machine";
import { SnapshotDetail } from "./snapshot-detail";
import { TimelineList } from "./timeline-list";

export function TimeMachineView() {
	const {
		history,
		selectedIndex,
		selectedSnapshot,
		diff,
		stepForward,
		stepBackward,
		goToLatest,
		goToFirst,
		goTo,
	} = useTimeMachine();

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
				e.preventDefault();
				stepBackward();
			} else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
				e.preventDefault();
				stepForward();
			} else if (e.key === "Home") {
				e.preventDefault();
				goToFirst();
			} else if (e.key === "End") {
				e.preventDefault();
				goToLatest();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [stepForward, stepBackward, goToLatest, goToFirst]);

	return (
		<div className="flex h-full">
			{/* Timeline sidebar */}
			<div className="w-[260px] shrink-0 flex flex-col">
				<div className="flex items-center gap-1 p-2 border-b border-neutral-800">
					<button
						type="button"
						onClick={goToFirst}
						disabled={selectedIndex <= 0}
						className="px-1.5 py-0.5 text-[10px] rounded bg-neutral-800 text-neutral-400 hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-default"
					>
						⏮
					</button>
					<button
						type="button"
						onClick={stepBackward}
						disabled={selectedIndex <= 0}
						className="px-1.5 py-0.5 text-[10px] rounded bg-neutral-800 text-neutral-400 hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-default"
					>
						◀
					</button>
					<span className="text-[10px] text-neutral-500 mx-1">
						{history.length > 0
							? `${selectedIndex + 1} / ${history.length}`
							: "0 / 0"}
					</span>
					<button
						type="button"
						onClick={stepForward}
						disabled={selectedIndex >= history.length - 1}
						className="px-1.5 py-0.5 text-[10px] rounded bg-neutral-800 text-neutral-400 hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-default"
					>
						▶
					</button>
					<button
						type="button"
						onClick={goToLatest}
						disabled={selectedIndex >= history.length - 1}
						className="px-1.5 py-0.5 text-[10px] rounded bg-neutral-800 text-neutral-400 hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-default"
					>
						⏭
					</button>
				</div>
				<TimelineList
					history={history}
					selectedIndex={selectedIndex}
					onSelect={goTo}
				/>
			</div>

			{/* Detail pane */}
			<div className="flex-1 min-w-0">
				<SnapshotDetail snapshot={selectedSnapshot} diff={diff} />
			</div>
		</div>
	);
}
