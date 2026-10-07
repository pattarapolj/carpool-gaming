import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
		react(),
		VitePWA({
			registerType: "autoUpdate",
			manifest: {
				name: "Carpool Quiz League",
				short_name: "Carpool Quiz",
				description: "A relaxed trivia game for cars travelling together.",
				start_url: "/",
				display: "standalone",
				background_color: "#f6f1e7",
				theme_color: "#f6f1e7",
				icons: [
					{
						src: "/carpool.svg",
						sizes: "any",
						type: "image/svg+xml",
					},
				],
			},
			workbox: {
				navigateFallbackDenylist: [/^\/v1\//],
			},
		}),
	],
	server: {
		proxy: {
			"/v1": "http://127.0.0.1:3000",
		},
	},
});
