/**
 * Open demo mode (DEMO_OPEN=1): the manual-refresh and founder-edit buttons work with no passcode.
 * Default is OFF: with it off, both require ADMIN_PASSCODE. Costs stay bounded either way: manual refreshes keep their
 * 10-minute cooldown and the monthly search-credit budget, and a refresh can never touch founder-owned data.
 * Turn it off after the demo (set DEMO_OPEN=0 and ADMIN_PASSCODE) because while it is on anyone with the link can edit notes.
 */
export const isOpenDemo = () => process.env.DEMO_OPEN === "1";
