import express from "express";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prismaInstallationStore } from "./installation-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createOAuthServer(): express.Application {
  const expressApp = express();

  const CLIENT_ID = process.env.SLACK_CLIENT_ID!;
  const CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET!;
  const STATE_SECRET = process.env.SLACK_STATE_SECRET!;
  const APP_URL = process.env.APP_URL!;

  const REDIRECT_URI = `${APP_URL}/slack/oauth_redirect`;

  const SCOPES = [
    "app_mentions:read",
    "channels:history",
    "groups:history",
    "im:history",
    "im:write",
    "mpim:history",
    "chat:write",
    "users:read",
    "channels:read",
    "groups:read",
    "reactions:read",
    "assistant:write",
  ].join(",");

  // Landing page
  expressApp.get("/", async (_req, res) => {
    try {
      const html = await readFile(
        join(__dirname, "../public/index.html"),
        "utf-8"
      );
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch {
      res.status(500).send("Landing page not found");
    }
  });

  // Initiate OAuth — redirect to Slack's authorise URL
  expressApp.get("/slack/install", (_req, res) => {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      state: STATE_SECRET,
    });
    res.redirect(
      `https://slack.com/oauth/v2/authorize?${params.toString()}`
    );
  });

  // OAuth callback — exchange code for token and store it
  expressApp.get("/slack/oauth_redirect", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      console.error("[OAuth] Error from Slack:", error);
      res.send("Installation cancelled.");
      return;
    }

    if (state !== STATE_SECRET) {
      res.status(400).send("Invalid state parameter.");
      return;
    }

    try {
      // Exchange the code for a token
      const tokenResp = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: code as string,
          redirect_uri: REDIRECT_URI,
        }),
      });

      const data = (await tokenResp.json()) as {
        ok: boolean;
        error?: string;
        team?: { id: string; name: string };
        bot_user_id?: string;
        access_token?: string;
        app_id?: string;
        authed_user?: { id: string };
      };

      if (!data.ok) {
        throw new Error(data.error ?? "OAuth failed");
      }

      // Build installation object and store it
      const installation = {
        team: { id: data.team!.id, name: data.team!.name },
        bot: {
          token: data.access_token!,
          userId: data.bot_user_id!,
          scopes: [],
          id: undefined,
        },
        appId: data.app_id,
        user: {
          id: data.authed_user?.id ?? "",
          scopes: [],
          token: undefined,
        },
      };

      await prismaInstallationStore.storeInstallation(installation as never);

      console.log(`[OAuth] Workspace ${data.team!.name} installed ThreadNote`);
      res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2>✅ ThreadNote installed successfully!</h2>
          <p>Head back to Slack — I've sent you a welcome message to get started.</p>
          <a href="slack://open">Open Slack</a>
        </body></html>
      `);
    } catch (err) {
      console.error("[OAuth] Token exchange failed:", err);
      res.status(500).send("Installation failed. Please try again.");
    }
  });

  return expressApp;
}
