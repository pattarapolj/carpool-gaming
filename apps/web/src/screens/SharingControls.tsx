import { useEffect, useRef, useState } from "react";

export function SharingControls({ joinCode }: { joinCode: string }) {
	const [message, setMessage] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const [manual, setManual] = useState(false);
	useEffect(() => {
		if (manual) {
			input.current?.focus();
			input.current?.select();
		}
	}, [manual]);
	const url = new URL(window.location.pathname, window.location.origin);
	url.searchParams.set("join", joinCode);
	const invite = url.toString();
	async function copy() {
		try {
			if (!navigator.clipboard) throw new Error("Clipboard unavailable");
			await navigator.clipboard.writeText(invite);
			setMessage("Invite link copied.");
		} catch {
			setManual(true);
			setMessage("Copy the invite link above and send it to the other cars.");
		}
	}
	async function share() {
		try {
			await navigator.share({
				title: "Carpool Quiz League",
				text: `Join our game with code ${joinCode}`,
				url: invite,
			});
		} catch (cause) {
			if (cause instanceof Error && cause.name === "AbortError") return;
			await copy();
		}
	}
	return (
		<div className="sharing-controls">
			{manual ? (
				<>
					<label htmlFor="invite-link">Invite link</label>
					<input ref={input} id="invite-link" readOnly value={invite} />
				</>
			) : null}
			<div className="action-row">
				{typeof navigator.share === "function" ? (
					<button type="button" className="quiet-button" onClick={share}>
						Share invite
					</button>
				) : (
					<button type="button" className="quiet-button" onClick={copy}>
						Copy invite link
					</button>
				)}
			</div>
			{message ? (
				<p className="share-feedback" role="status">
					{message}
				</p>
			) : null}
		</div>
	);
}
