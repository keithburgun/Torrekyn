# Cloud saves

Torrekin keeps your **rating, achievements, the game in progress, and the card-art and battle-speed settings** in
sync across devices. Screen layout and sound stay per device. Everything works offline; it catches up later.

## How it's built (`src/save/`)

| File | What it does |
|---|---|
| `store.ts` | All saved data goes through here. Synced keys get a "last changed" time on every write. |
| `doc.ts` | The save document (every synced key + its time) and the **three-way merge**: when two devices both changed things since they last agreed, achievements are combined (unlocks kept, counters added up), the rating keeps the newer value with both game histories, and the game in progress / settings take the newer copy. |
| `sync.ts` | The sync engine: read cloud copy → merge → write only if nobody wrote in between (else retry) → apply here. Runs ~2.5 s after a change, when the app goes to the background, at start, and every few minutes. The game you're playing is never swapped out from under you. |
| `cloud.ts` | The provider interface every save location implements (`read`, `write` with a revision check). |
| `providers/supabase.ts` | **In use now.** Email + password accounts on Supabase, the same project and accounts as Spellstorm. |
| `providers/platform.ts` | **Ready for later:** Steam Cloud, Google Play Games Saved Games, iCloud. Each switches on when the app wrapper provides a small native bridge (contract in the file). When one is available the game uses it automatically instead of asking for an account. |

The copy inside Claude has cloud saves turned off (it can't reach outside servers). Everything else has them:
the web version, itch.io, Windows and Android.

## One-time setup on Supabase

Open the Supabase project (the Spellstorm one, `bdncsprakdvvmfnxxlqr`) → **SQL Editor** → run:

```sql
create table if not exists public.game_saves (
  user_id    uuid        not null references auth.users on delete cascade,
  game       text        not null,
  slot       text        not null default 'profile',
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, game, slot)
);
alter table public.game_saves enable row level security;
create policy "Players read their own saves"   on public.game_saves for select using (auth.uid() = user_id);
create policy "Players create their own saves" on public.game_saves for insert with check (auth.uid() = user_id);
create policy "Players update their own saves" on public.game_saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

`game_saves` is shared by game (`game = 'torrekin'`), so future games can use the same table. Spellstorm's own
`saves` table is untouched.

Until the table exists, signing in works but the game shows "Cloud saves aren't set up on the server yet."

Password-reset emails use the project's Site URL (Supabase → Authentication → URL Configuration), which is
Spellstorm's; resetting there works for both games because the accounts are shared.

## Moving to Steam / app stores later

- **Steam:** add Tauri commands `steam_cloud_status`, `steam_cloud_read`, `steam_cloud_write` (Rust `steamworks`
  crate, RemoteStorage), set `window.__STEAM__ = true` in the Steam build, and enable Steam Cloud in Steamworks.
- **Google Play / iOS:** a Capacitor plugin named `CloudSave` with `status`, `read`, `write` (Play Games
  SnapshotsClient on Android; iCloud key-value store or CloudKit on iOS).

Nothing else in the game changes: the same document and merge rules are used whatever the provider.
