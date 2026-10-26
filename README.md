# Witchwind Systems

Quests, a shared journal, maps with markers and factions in one book, in the style of [Witchwind Inventory](https://github.com/Hierarchs/Witchwind-Inventory-System-VTT) and [Witchwind UI](https://github.com/Hierarchs/Witchwind-UI): dark leather and gold around Oblivion's parchment pages, Cinzel headings, square slots and gold diamonds. Quests track and announce themselves as in the Elder Scrolls games.

Press **J** to open it (or **M** for the map), click the book among the token tools on the left, or use the button at the top of the Journal tab. It fills the screen, as Simple Quest does: the four tabs run across a leather bar at the top, and the parchment pages fill the rest. Press **Esc** or **J** again to close it. Editors, pictures and dialogs open above it.

- **Big screens.** On 1440p and 4K screens the whole menu scales up together and fills the screen, and the map takes the full width.
- **Animations.** The book fades in with its tab bar dropping into place and the pages rising; list entries file in on each tab and filter, a newly chosen entry rises onto the page, markers pop onto the map, and the open tab's gold rule draws out from its middle. A ticked objective's diamond fills with a pop of gold, a quest's new status stamps onto the page, a faction's standing marker slides to its new place, a promoted member's portrait glows, unfolded steps drop into place, and new quests and objectives slide into the tracker. Re-renders caused by someone else's change play nothing, so the page never flickers while you read. All of it switches off if your system asks for reduced motion.
- **Sounds.** The book can play a sound as it opens and closes, turn a page on each new tab or entry, and sound a fanfare with quest banners. No sounds ship with the module: upload your own audio files to your Foundry server and choose them under **Configure Settings > Witchwind Systems**. Each player sets their own volume, or turns it to zero.
- **Keyboard.** Up and Down move through the list, Left and Right change tab, Esc closes. While the book is open they don't pan the map underneath.

### Quests

- **Two pages.** Current quests on the left, in groups, with Completed, Failed and Recent Updates across the top as in Oblivion. The chosen quest fills the right page.
- **Your own groups.** Main, Side, Faction and Miscellaneous to start; rename them, add your own (Companions, Guild Contracts…) and put them in order with the layers button. Drag quests to reorder them, or onto a group's heading to move them there.
- **Quest chains.** Make a quest a step of another ("Part of" in the editor, or **Add a step** on the quest's page). Steps fold under their quest on a thread, with "2 of 5 steps done", and fold away with the caret. A step's page links back to its quest, and a quest's page lists its steps.
- **Objectives** are gold diamonds: hollow while open, filled when done, struck through when failed. Optional ones say so. The GM ticks them off right on the page.
- **A journal per quest.** Dated entries, newest first, tell the story as it's played. The GM can write entries ahead of time, hidden, and reveal them when the moment comes; the same goes for objectives.
- **Giver, location, faction and rewards.** Drop an actor in as the quest giver and items in as rewards; rewards are Witchwind Inventory's slots, framed by rarity. Click either to open its sheet.
- **Track quests.** Tracked quests and their open objectives sit in a small steel card on your screen; drag it wherever you like. A tracked quest's marker on the map breathes with a gold ring.
- **Quest pop-ups.** When a quest is added, completed or failed, each player gets Oblivion's box in Witchwind's leather and parchment: "Quest Added" over the quest's icon (its picture or its faction's emblem), its name, the date in red in the world's own calendar ("27th of Last Seed, 433"), a line about it, and **Continue** (or Enter, or Esc). **View Quest** opens the book at it. Several arriving together follow one another. Each player can switch them off for banners instead.
- **Announcements.** "Objective Complete", "New Objective" and "Quest Updated" fade in across the top of each player's screen, Elder Scrolls style.
- **GM tools** sit on their own dashed strip: add an entry, edit, hide or reveal, show to players, complete, fail, reopen, delete. New quests start hidden, so you can prepare them in advance.

### Journal

- **Everyone writes.** Players and the GM add notes, sorted into General, People, Places, Lore and Clues, with a picture if you like. Search covers titles and text.
- **Shared or private.** A shared note is for the whole party; a private one is only for you and the GM.
- **Upload.** Drop a picture or a `.txt`, `.md` or `.html` file anywhere on the journal to start a note from it, or use **Import a text file** in the editor. Players without upload permission can still attach pictures: their browser shrinks the picture and a connected GM's client stores it.
- **Show to players** opens a note on everyone's screen; click a note's picture to see it full size, and share it from there.
- **Links.** Link a note to a quest, a faction or a map marker. The note shows them as chips, and the quest's page, the faction's page and the marker's card list the notes linked to them.

### Maps

- **The GM uploads maps** with the Upload button, by dropping pictures onto the list of maps, or by choosing a picture already on the server. New maps start hidden; reveal one when the party should see it.
- **Pan and zoom** by dragging and scrolling; the tools on the right zoom, fit the map and show or hide marker names.
- **Markers.** Anyone can place one with **Place marker** or a double-click: pick from twenty icons and seven colors, give it a name and notes, and link it to a quest or faction. Drag your own markers to move them. A private marker is only for you and the GM; the GM's private markers are for GMs only.
- **Show on map.** A quest with a linked marker gets a button that opens its map, centered on the marker.
- **Find and filter.** Search markers by name and notes (matches glow, the rest fade; Enter jumps to the first), and open the legend to hide or show each kind of marker.

### Standing

The Standing tab has two modes, **Factions** and **Renown**, on tabs above the list.

#### Factions

- **Standing.** A bar from Hated to Revered with the party's place on it in gold. The GM nudges it with + and −.
- **Ranks.** Each faction has its own ladder of ranks, highest first, with each member's portrait beside their rank. Players see their own characters' ranks called out, and get a banner when they're promoted or join.
- **And more:** emblem and color, motto, leader, headquarters, allies and rivals (which link to each other), the faction's quests, a description and GM notes.
- **Members.** Drop actors onto a faction's page, or use **Add the party** in the editor.
- **Personal standing.** Each character can have their own standing alongside the party's, nudged with + and − beside their portrait or set in the editor. Characters who aren't members ("Not a member") are listed as known to the faction with their standing, and can be made members with one click.

### Journal and letters

The Journal has two tabs. **Notes** are the table's own session notes, which anyone can write and share. **Letters** are in-world things the GM writes and hands out, such as letters, books, notices and orders. **New Note** writes a note on the Notes tab, and the GM uses **New Letter** on the Letters tab. The rest of the letter details are below.

- **In-world letters, books, notices and orders** the GM writes and hands out, read inside the book on a sheet of paper with a seal or picture, signed by the sender.
- **Delivered on a day.** A letter can arrive now or a set number of days later in the world's calendar. It stays hidden until the world's clock reaches that day, then arrives with a "Letter Arrived" pop-up and a **Read Letter** button. The GM can deliver one early.
- **Unread marks.** Players see which letters they haven't opened, and can list only those.

### Bestiary

- **Creatures the party has met**, copied from their monster in the Monsters compendium. As GM, drag a monster from the compendium onto the Bestiary page; the stats come across, and the creature is hidden until you log an encounter with it.
- **Encounters.** Log where and when the party met a creature. Logging the first one shows its basics (its kind and size) to everyone.
- **Facts, one at a time.** Each part of the record (threat, defenses, movement, abilities, resistances, languages, skills, attacks, traits and spells, tactics, lore, habitat) is revealed on its own, to everyone or to chosen players, with a chip for each. Players see a locked card for anything not yet revealed, and nothing hidden is shown on their screen.
- **Learned pop-ups.** A player gets a pop-up when a fact about a creature is revealed to them.
- **Refresh from the compendium** brings a creature's stats, biography and picture up to date with its monster, keeping what the table has learned.
- **Biography and artwork.** The monster's biography from the compendium becomes its Lore, with its large picture above the record. Your own lore is written under it.

A creature's record is copied, not linked, so it stays whole if the compendium changes. Like everything else in the module, the facts you haven't revealed are stored in the world, so a player who looked in the browser's console could find them.

### Notice board

- **Notices pinned up by region.** The GM posts contracts and bounties under regions, such as Ravensmoor or Millbrook, each with a difficulty, a reward and who is asking. They are pinned to a wooden board, and the one you choose opens on the right.
- **Regions.** Set your regions with the map button on the board. Renaming one keeps its notices. Removing one leaves its notices unfiled.
- **Hidden or limited.** A notice can be hidden until you reveal it, or limited to chosen players, as with other entries.
- **Staying up.** Choose how many days a notice stays up. 0 keeps it up until it is taken or taken down.
- **Taking a contract.** A player can take an open notice. It becomes a quest in their Quests, shared with the players who could see the notice, and the board shows who took it. This needs a GM online, since the quest is made on the GM's screen.
- **Taken down.** The GM can take a notice down, and put it back up while nobody has taken it.

#### Renown

- **A card for each character** with the titles they've earned, such as "Warden of the Vale": what the title means, what earned it, the date in the world's calendar, and the quest behind it. Below that, their rank and standing in each faction they're known to.
- **Granting a title** pops up "Title Earned" for the character's player.
- **On the character sheet.** dnd5e character and NPC sheets get a small Renown card in their sidebar with the character's titles and faction ranks; each opens the book at it. Each player can turn it off.

### Merchants

- **Who sells what**: each merchant's wares as slots with prices and how many are left, their location and faction. Players browse; the GM marks sales with − and + on the page, or edits the stock.
- **Restocking.** A merchant can restock every so many days of the world's calendar, refilling each ware to its usual amount as the clock passes; the GM can restock early. Drop items from the sidebar or a compendium into the stock to add them with their picture and price.

### The Xerseraya calendar

The world runs on the Xerseraya calendar: seven days to the week (Dawnwake, Morrow, Highsun, Waning, Evenfall, Deepnight, Stillhour) and twelve months of thirty days (First Light, Snow's End, Soils Break, Seeds Rest, Guiding Rain, Cloudbreak, Sun's Mantle, First Harvest, Harvest's End, Waning Sun, Flakefall, Last Light), 360 days a year with no leap years. Pop-ups, letters, titles and restocks give dates in it ("Highsun, 27th of First Harvest, 433"), and so does Foundry's own clock. **World calendar** in the settings switches back to Foundry's calendar, or another calendar module's.

### Who can see it

Every quest, map, faction, note and marker can be shown to all players or only some: tick the players in its editor. Limited entries carry a small lock-and-person mark for the GM, and "Only Aria, Bren" on their page.

### Backups and imports

Under **Configure Settings > Witchwind Systems > Backups and Imports** (GM only):

- **Download backup** saves every quest, note, map, marker and faction, with your quest groups, as one file.
- **Restore** loads one, replacing what's there or adding to it. Notes and markers go back to whoever wrote them, or to you if they aren't in this world.
- **Import from the Journal** turns each journal entry in a folder into a quest: the first page becomes its details, each further page a step, and checklist items its objectives. Folders named Completed or Failed set the status. This works with Simple Quest's folders.

## Requirements

- Foundry VTT v14
- Any system. Rewards read dnd5e's item rarity for their frames when it's there.

## Installing

Install it from this manifest URL (Foundry's **Install Module** dialog, or your host's module manager):

```
https://raw.githubusercontent.com/Hierarchs/Witchwind-Systems/main/module.json
```

Then enable **Witchwind Systems** in your world's module settings.

## Settings

Under **Configure Settings > Witchwind Systems**:

| Setting | What it does |
|---|---|
| Quests, Journal, Bestiary, Notice board, Maps, Standing and Merchants tabs | Switch each section on or off for the whole world. Use only what your table needs. |
| Renown on character sheets | The Renown card in dnd5e sheets' sidebars. Each player's own choice. |
| Players can write in the journal | Lets players add notes, and edit or delete their own. |
| Players can place map markers | Lets players place markers, and move or delete their own. |
| Announce quest updates | The Elder Scrolls style banners for quest and faction changes. |
| Show the quest tracker | Each player's own choice. |
| Quest pop-ups | Oblivion's box for quests added, completed or failed; off shows a banner instead. Each player's own choice. |
| Sounds: book opens, closes, page turns (two), quest updates | Audio files on your server, chosen by the GM. Empty plays nothing. |
| Sound volume | Each player's own volume; zero turns the sounds off. |
| Backups and Imports | Download, restore or import from the Journal (GM only). |

Keys are under **Configure Controls > Witchwind Systems**: J opens or closes the book, M opens the maps, and the other sections can be given keys of their own.

## For macros and other modules

```js
const api = game.modules.get("witchwind-systems").api;
api.open("quests");              // or "journal", "maps", "factions"; add an entry's id to open it
api.toggle();
api.announce({ label: "Quest Started", title: "The Hollow Crown", detail: "Speak to Captain Holt" });
api.notice({ label: "Quest Added", title: "The Hollow Crown", detail: "Grave robbers took the crown." });
```

## Notes

- The book only re-renders when something it's showing changes, reads each collection once per change, remembers enriched text, and darkens the game behind it without a backdrop blur (which would re-blur the live canvas every frame). The map keeps its decoded picture across re-renders, so large maps don't blink when something changes, and panning and zooming draw once per frame.
- Quests, maps and factions are kept in world settings. Notes and markers are kept on the User of whoever wrote them, so players can write without a GM online (only uploading a picture without upload permission needs a GM connected).
- Uploaded pictures go to the module's storage folder (`modules/witchwind-systems/storage/`), which survives module updates.
- Hidden quests, private notes and GM notes are hidden in the interface, but like the rest of a world's data they're sent to every connected client, so a player poking around in the browser console could find them.
- The fonts (Cinzel, Alegreya, Alegreya Sans) are the same files Witchwind Inventory and Witchwind UI bundle, so the look doesn't depend on an internet connection.

## License

The module's code is under the [MIT License](LICENSE). The bundled fonts are under the SIL Open Font License 1.1; each license is in `fonts/`. The notice board's titles use Kingthings Petrock, by Kevin King, whose license note is in `fonts/Kingthings-License.txt`.

## Releasing a new version

1. Bump `version` in `module.json`.
2. Run `build.ps1` to rebuild `dist/witchwind-systems.zip`.
3. Commit and push. Foundry will offer the update the next time it checks.
