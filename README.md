# Witchwind Systems

Quests, a shared journal, maps with markers and factions in one book, in the style of [Witchwind Inventory](https://github.com/Hierarchs/Witchwind-Inventory-System-VTT) and [Witchwind UI](https://github.com/Hierarchs/Witchwind-UI): dark leather and gold around Oblivion's parchment pages, Cinzel headings, square slots and gold diamonds. Quests track and announce themselves as in the Elder Scrolls games.

Press **J** to open it (or **M** for the map), click the book among the token tools on the left, or use the button at the top of the Journal tab. Four tabs run along the bottom of the book, as in Oblivion's menu.

### Quests

- **Two pages.** Current quests on the left, grouped into Main, Side, Faction and Miscellaneous, with Completed, Failed and Recent Updates across the top as in Oblivion. The chosen quest fills the right page.
- **Objectives** are gold diamonds: hollow while open, filled when done, struck through when failed. Optional ones say so. The GM ticks them off right on the page.
- **A journal per quest.** Dated entries, newest first, tell the story as it's played. The GM can write entries ahead of time, hidden, and reveal them when the moment comes; the same goes for objectives.
- **Giver, location, faction and rewards.** Drop an actor in as the quest giver and items in as rewards; rewards are Witchwind Inventory's slots, framed by rarity. Click either to open its sheet.
- **Track quests.** Tracked quests and their open objectives sit in a small steel card on your screen; drag it wherever you like. A tracked quest's marker on the map breathes with a gold ring.
- **Announcements.** "Quest Started", "Objective Complete", "Quest Updated", "Quest Completed" and "Quest Failed" fade in across the top of each player's screen, Elder Scrolls style.
- **GM tools** sit on their own dashed strip: add an entry, edit, hide or reveal, show to players, complete, fail, reopen, delete. New quests start hidden, so you can prepare them in advance.

### Journal

- **Everyone writes.** Players and the GM add notes, sorted into General, People, Places, Lore and Clues, with a picture if you like. Search covers titles and text.
- **Shared or private.** A shared note is for the whole party; a private one is only for you and the GM.
- **Upload.** Drop a picture or a `.txt`, `.md` or `.html` file anywhere on the journal to start a note from it, or use **Import a text file** in the editor. Players without upload permission can still attach pictures: their browser shrinks the picture and a connected GM's client stores it.
- **Show to players** opens a note on everyone's screen; click a note's picture to see it full size, and share it from there.

### Maps

- **The GM uploads maps** with the Upload button, by dropping pictures onto the list of maps, or by choosing a picture already on the server. New maps start hidden; reveal one when the party should see it.
- **Pan and zoom** by dragging and scrolling; the tools on the right zoom, fit the map and show or hide marker names.
- **Markers.** Anyone can place one with **Place marker** or a double-click: pick from twenty icons and seven colors, give it a name and notes, and link it to a quest or faction. Drag your own markers to move them. A private marker is only for you and the GM; the GM's private markers are for GMs only.
- **Show on map.** A quest with a linked marker gets a button that opens its map, centered on the marker.

### Factions

- **Standing.** A bar from Hated to Revered with the party's place on it in gold. The GM nudges it with + and −.
- **Ranks.** Each faction has its own ladder of ranks, highest first, with each member's portrait beside their rank. Players see their own characters' ranks called out, and get a banner when they're promoted or join.
- **And more:** emblem and color, motto, leader, headquarters, allies and rivals (which link to each other), the faction's quests, a description and GM notes.
- **Members.** Drop actors onto a faction's page, or use **Add the party** in the editor.

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
| Quests, Journal, Maps and Factions tabs | Switch each section on or off for the whole world. Use only what your table needs. |
| Players can write in the journal | Lets players add notes, and edit or delete their own. |
| Players can place map markers | Lets players place markers, and move or delete their own. |
| Announce quest updates | The Elder Scrolls style banners for quest and faction changes. |
| Show the quest tracker | Each player's own choice. |

Keys are under **Configure Controls > Witchwind Systems**: J opens or closes the book, M opens the maps, and the other sections can be given keys of their own.

## For macros and other modules

```js
const api = game.modules.get("witchwind-systems").api;
api.open("quests");              // or "journal", "maps", "factions"; add an entry's id to open it
api.toggle();
api.announce({ label: "Quest Started", title: "The Hollow Crown", detail: "Speak to Captain Holt" });
```

## Notes

- Quests, maps and factions are kept in world settings. Notes and markers are kept on the User of whoever wrote them, so players can write without a GM online (only uploading a picture without upload permission needs a GM connected).
- Uploaded pictures go to the module's storage folder (`modules/witchwind-systems/storage/`), which survives module updates.
- Hidden quests, private notes and GM notes are hidden in the interface, but like the rest of a world's data they're sent to every connected client, so a player poking around in the browser console could find them.
- The fonts (Cinzel, Alegreya, Alegreya Sans) are the same files Witchwind Inventory and Witchwind UI bundle, so the look doesn't depend on an internet connection.

## License

The module's code is under the [MIT License](LICENSE). The bundled fonts are under the SIL Open Font License 1.1; each license is in `fonts/`.

## Releasing a new version

1. Bump `version` in `module.json`.
2. Run `build.ps1` to rebuild `dist/witchwind-systems.zip`.
3. Commit and push. Foundry will offer the update the next time it checks.
