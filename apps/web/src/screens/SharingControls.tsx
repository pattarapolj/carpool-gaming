import { useRef, useState } from "react";

export function SharingControls({ joinCode }: { joinCode: string }) {
	const [message, setMessage] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const url = new URL(window.location.pathname, window.location.origin);
	url.searchParams.set("join", joinCode);
	const invite = url.toString();
	async function copy() {
		try {
			if (!navigator.clipboard) throw new Error("Clipboard unavailable");
			await navigator.clipboard.writeText(invite);
			setMessage("Invite link copied.");
		} catch {
			input.current?.focus();
			input.current?.select();
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
		} catch {
			setMessage("Share didn't finish. Copy the invite link above.");
		}
	}
	return (
		<div className="sharing-controls">
			<label htmlFor="invite-link">Invite link</label>
			<input ref={input} id="invite-link" readOnly value={invite} />
			<div className="action-row">
				<button type="button" className="quiet-button" onClick={copy}>
					Copy invite link
				</button>
				{typeof navigator.share === "function" ? (
					<button type="button" className="quiet-button" onClick={share}>
						Share invite
					</button>
				) : null}
			</div>
			{message ? (
				<p className="share-feedback" role="status">
					{message}
				</p>
			) : null}
		</div>
	);
}
