import { useEffect, useState } from "react";

export function Countdown({
	target,
	serverTime,
	receivedAt,
	label,
}: {
	target: string | null;
	serverTime: string;
	receivedAt: number;
	label: string;
}) {
	const [now, setNow] = useState(() => performance.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(performance.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	const remaining = target
		? Math.ceil(
				(Date.parse(target) -
					Date.parse(serverTime) -
					Math.max(0, now - receivedAt)) /
					1000,
			)
		: 0;
	return (
		<p
			className={`countdown ${remaining > 0 && remaining <= 10 ? "countdown-urgent" : ""}`}
		>
			{remaining > 0
				? `${label} ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
				: "Waiting for the server's next update…"}
		</p>
	);
}
