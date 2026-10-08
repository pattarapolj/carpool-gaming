import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
		react(),
		VitePWA({
			registerType: "autoUpdate",
			includeAssets: [
				"favicon.ico",
				"favicon.svg",
				"apple-touch-icon.png",
				"brand/horizontal.svg",
			],
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
						src: "/icon-192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "/icon-512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "/maskable-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
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
			"/socket.io": { target: "http://127.0.0.1:3000", ws: true },
		},
	},
});
