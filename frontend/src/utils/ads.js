const BLOCK_ID = import.meta.env.VITE_ADSGRAM_BLOCK_ID;
let controller = null;

export async function showAd() {
  if (!BLOCK_ID) {
    console.warn("[ads] VITE_ADSGRAM_BLOCK_ID is empty in this build");
    return false;
  }
  if (!window.Adsgram) {
    console.warn("[ads] window.Adsgram not found (script blocked or not loaded)");
    return false;
  }
  try {
    controller = controller || window.Adsgram.init({ blockId: BLOCK_ID });
    const result = await controller.show();
    console.log("[ads] finished:", result);
    return true;
  } catch (err) {
    console.warn("[ads] not shown:", err);
    return false;
  }
}