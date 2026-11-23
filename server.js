import express from "express";
import { Bot } from "grammy";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";

const app = express();
const PORT = process.env.PORT || 10000;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = String(process.env.TELEGRAM_OWNER_ID || "");
const MODEL = process.env.OPENCODE_MODEL;

const WORKSPACE = "/tmp/workspace";

if (!TOKEN || !OWNER_ID || !MODEL) {
  throw new Error("Missing required environment variables");
}

fs.mkdirSync(WORKSPACE, { recursive: true });

// Clone public repository if configured
if (process.env.GIT_REPO_URL &&
    !fs.existsSync(`${WORKSPACE}/.git`)) {
  execFileSync("git", [
    "clone",
    "--depth",
    "1",
    process.env.GIT_REPO_URL,
    WORKSPACE
  ], { stdio: "inherit" });
}

let busy = false;

app.get("/", (req, res) => {
  res.send("OpenCode Telegram Worker is running");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    opencode: true,
    busy,
    uptime: process.uptime()
  });
});

const bot = new Bot(TOKEN);

function authorized(ctx) {
  return String(ctx.from?.id) === OWNER_ID;
}

bot.command("start", async (ctx) => {
  if (!authorized(ctx)) return;

  await ctx.reply(
    "OpenCode Worker Ready!\n\n" +
    "/status - Check status\n" +
    "/run <prompt> - Execute coding task"
  );
});

bot.command("status", async (ctx) => {
  if (!authorized(ctx)) return;

  await ctx.reply(
    `Worker: ONLINE\n` +
    `OpenCode: READY\n` +
    `Busy: ${busy}\n` +
    `Uptime: ${Math.floor(process.uptime())} seconds`
  );
});

bot.command("run", async (ctx) => {
  if (!authorized(ctx)) return;

  const prompt = String(ctx.match || "").trim();

  if (!prompt) {
    return ctx.reply("Usage: /run Fix the login bug");
  }

  if (busy) {
    return ctx.reply("Agent is currently busy.");
  }

  busy = true;

  await ctx.reply("🤖 OpenCode is working...");

  const child = spawn(
    "opencode",
    [
      "run",
      "--model",
      MODEL,
      "--auto",
      prompt
    ],
    {
      cwd: WORKSPACE,
      env: process.env
    }
  );

  let output = "";
  let error = "";

  child.stdout.on("data", (data) => {
    output += data.toString();
    if (output.length > 12000) {
      output = output.slice(-12000);
    }
  });

  child.stderr.on("data", (data) => {
    error += data.toString();
    if (error.length > 4000) {
      error = error.slice(-4000);
    }
  });

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 10 * 60 * 1000);

  child.on("error", async (err) => {
    clearTimeout(timeout);
    busy = false;
    await ctx.reply(`Execution error: ${err.message}`);
  });

  child.on("close", async (code) => {
    clearTimeout(timeout);
    busy = false;

    const result = output || error || "No output.";

    const message =
      `Finished. Exit code: ${code}\n\n` +
      result.slice(-3500);

    await ctx.reply(message).catch(() => {});
  });
});

bot.catch((err) => {
  console.error("Telegram error:", err);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on ${PORT}`);
});

bot.start({
  onStart: () => console.log("Telegram bot started")
}).catch(console.error);
