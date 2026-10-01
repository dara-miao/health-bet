# Health Bet

A scorekeeper for a health bet between friends. You text your AI agent ([Poke](https://poke.com)) what you ate and when you sleep. It estimates calories and macros and logs them here through an MCP connection. A shared scoreboard shows who's winning, and each player has a private page with their own meals, macros, and weight. Every morning Poke texts you a recap, and every Monday it announces who lost the week.

There's no AI cost on the app side: Poke does the estimating. Hosting runs on Cloudflare's free tier.

## Rules

Each day, each player earns up to 4 points:

| | Cut player | Bulk player |
|---|---|---|
| 🔥 Calories | **at or under** your target (but not under 1,200) | **at or over** your target |
| 💪 Protein | at or over your target | at or over your target |
| 😴 Sleep | at least **7 hours** | at least **7 hours** |
| ⏰ Wake-up | up by **8:30am** weekdays, **10:30am** Sat/Sun (10 min grace) | same |

The wake-up time is when you text Poke "gm", so send it when you actually get up.

- Fat and carbs are tracked and shown, with an optional fat minimum and reminders, but **don't score**.
- Not logging any food that day earns no food points.
- **Week = Monday to Sunday.** Lowest total loses and does the punishment. A tie on points goes to whoever slept more. If that's tied too, it's a draw.
- Days end at **4am** Pacific, so a 1am snack counts for the day before. A night's sleep counts toward the day you wake up.
## What the other player can see

| | Shared scoreboard (both of you) | Your private page (only you) |
|---|---|---|
| Points, week standings | ✅ | ✅ |
| Calorie and protein totals | ✅ | ✅ |
| Sleep and wake-up times | ✅ | ✅ |
| Your meals | only the ones you share | ✅ all of them |
| Fat and carbs | – | ✅ |
| Weight | – | ✅ |

Meals are private until you share them: tap **Share** on a meal (or **Share all** for a whole day) on your private page, or tell Poke "share my dinner" or "share all my meals today". **Unshare** takes it back. The daily recap sent to both of you contains only the shared fields; your 9pm check-in is just for you.

## What you can text Poke

- "greek yogurt with granola and blueberries" → logs it with an estimate
- "actually it was 2 cups" / "remove the banana" → fixes it
- "gn" … "gm" → logs your sleep
- "slept 1am to 7am" → logs a night after the fact
- "how much protein do I have left?" / "who's winning?"
- "share my dinner with Mal" / "what's my private page?"
- "weighed 137 this morning"
- "set my goal: cut, 1700 cal, 120g protein, 45g fat"
- "set the punishment to loser buys boba for a week"

## Automatic messages (through Poke)

- **10am:** yesterday's recap
- **Monday 10am:** the weekly verdict and punishment
- **9pm:** where you stand today, with tips if protein or fat is short

These need each player's Poke API key (entered on the join page). Without one, the scoreboard still works; you just won't get the texts.

## Setup (about 15 minutes, all in the browser)

1. **Deploy on Cloudflare.** Sign up free at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up), then:
   - Go to **Workers & Pages → Create → Import a repository**, connect GitHub, and pick this repo.
   - Leave the build command empty. Set the **deploy command** to `npm run deploy`.
   - Click **Deploy**. The first deploy creates the database.
   - Set up its tables: in the dashboard go to **Storage & Databases → D1 → health-bet → Console**, paste the contents of `migrations/0001_init.sql`, and run it. (Or from a terminal: `npm run db:migrate`.)

2. **Set the join code.** Open the worker, then go to **Settings → Variables and Secrets → Add**:
   - **Type:** Secret
   - **Name:** `JOIN_CODE`
   - **Value:** a password you and your friend will use. Make it long.

   Then redeploy from **Deployments** (or push any commit).

3. **Each player joins.** Your worker's URL is shown on its overview page, like `https://bet.<you>.workers.dev`. Open `/join` on it and enter:
   - the join code
   - your name
   - your Poke API key (optional). Create a V2 key in Poke's Kitchen. This is what lets the app text you recaps.

   The page shows your personal **API key** once, plus the scoreboard link. If you lose the key, join again with the same name to get a new one.

4. **Connect Poke.** Go to [poke.com/integrations/new](https://poke.com/integrations/new) and fill in:
   - **Name:** `Health Bet`
   - **MCP Server URL:** `https://bet.<you>.workers.dev/mcp`
   - **API Key:** your key from step 3

5. **Set your goal** by texting Poke, e.g. *"set my goal: cut, 1700 cal, 120g protein, 45g fat"*. Then log your first meal.

Prefer the terminal? Run `npm install`, `npx wrangler login`, `npx wrangler secret put JOIN_CODE`, then `npm run deploy`.

### Settings

Change these in `wrangler.toml` and push (Cloudflare redeploys automatically):

| Setting | Default | What it does |
|---|---|---|
| `GAME_TZ` | `America/Los_Angeles` | the timezone the game runs on |
| `SLEEP_TARGET_HOURS` | `7` | hours needed for the sleep point |
| `WAKE_WEEKDAY` / `WAKE_WEEKEND` | `08:30` / `10:30` | be up by this time for the wake-up point |
| `WAKE_GRACE_MINUTES` | `10` | minutes after the wake-up time that still count |
| `CUT_FLOOR_CALORIES` | `1200` | a cut day under this never earns the calorie point |

The 10am and 9pm send times are constants at the top of `src/index.ts`.

### Privacy notes

- The scoreboard and private-page links are secret but not password-protected: anyone with a link can open it. Share the scoreboard only with your friend, and your private page with no one. Joining again with the same name gives you a new private link (and the old one stops working).
- API keys are stored hashed. Poke API keys are stored as-is so the app can send messages with them.

## Development

```sh
npm test            # unit tests: scoring, day boundaries, privacy
npm run typecheck
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply health-bet --local
npm run dev         # then open http://localhost:8787/join
```

Code layout:

- `src/index.ts`: routes, the join flow, and scheduled messages
- `src/mcp.ts`: the MCP server and tools Poke calls (`log_food`, `edit_food`, `delete_food`, `share_meal`, `sleep_start`, `sleep_end`, `log_sleep`, `get_status`, `set_goal`, `log_weight`, `set_punishment`)
- `src/web.ts`: the join page, scoreboard, history charts, and private pages
- `src/game.ts`: sleep logging, meal visibility, and reports
- `src/scoring.ts`: the scoring rules (pure functions)
- `src/time.ts`: timezone and 4am-rollover date math
- `src/poke.ts`: sending messages through Poke's API
- `migrations/`: the D1 schema
