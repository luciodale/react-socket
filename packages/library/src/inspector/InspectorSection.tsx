import { type ReactNode, useState } from "react";
import { ChevronRightIcon } from "./icons";

type TInspectorSectionProps = {
	title: string;
	children: ReactNode;
	defaultOpen?: boolean;
};

export function InspectorSection({
	title,
	children,
	defaultOpen = true,
}: TInspectorSectionProps) {
	const [open, setOpen] = useState(defaultOpen);

	function handleToggle() {
		setOpen((prev) => !prev);
	}

	return (
		<div className="rsi-section">
			<button
				type="button"
				onClick={handleToggle}
				className="rsi-section-header"
			>
				<span className="rsi-section-chevron" data-open={open}>
					<ChevronRightIcon />
				</span>
				{title}
			</button>
			{open && <div className="rsi-section-content">{children}</div>}
		</div>
	);
}
