type TIconProps = {
	size?: number;
	className?: string;
};

export function ChevronRightIcon({ size = 12, className }: TIconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 12 12"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			<path
				d="M4.5 2.5L8 6 4.5 9.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function ChevronDownIcon({ size = 10, className }: TIconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 10 10"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			<path
				d="M2.5 4L5 6.5 7.5 4"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function CloseIcon({ size = 14, className }: TIconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 14 14"
			fill="none"
			className={className}
			aria-hidden="true"
		>
			<path
				d="M3.5 3.5l7 7M10.5 3.5l-7 7"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}
