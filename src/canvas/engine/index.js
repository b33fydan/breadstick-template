/**
 * Engine entry point: registers all lane executors once and re-exports the
 * engine API. CanvasView imports ONLY from here.
 */
import { registerExecutor, getExecutor } from './registry.js';
import { nicheScriptExecutor } from './executors/nicheScript.js';
import { gamiArtExecutor, titleCardExecutor } from './executors/imageBatch.js';
import { frameSandwichExecutor } from './executors/frameSandwich.js';
import { carouselRenderExecutor } from './executors/carouselRender.js';
import { ugcScriptExecutor } from './executors/ugcScript.js';
import { clipSplitExecutor } from './executors/clipSplit.js';
import { avatarFramesExecutor } from './executors/avatarFrames.js';
import { ugcVideoExecutor } from './executors/ugcVideo.js';

let registered = false;
export function registerLaneExecutors() {
  // Registry survives Vite HMR re-eval of this module — re-check it, not just our flag.
  if (registered || getExecutor('niche-gen')) return;
  registered = true;
  registerExecutor('niche-gen', nicheScriptExecutor);
  registerExecutor('gami-art', gamiArtExecutor);
  registerExecutor('title-card', titleCardExecutor);
  registerExecutor('frame-sandwich', frameSandwichExecutor);
  registerExecutor('carousel', carouselRenderExecutor);
  registerExecutor('ugc-gen', ugcScriptExecutor);
  registerExecutor('clip-splitter', clipSplitExecutor);
  registerExecutor('avatar-frame', avatarFramesExecutor);
  registerExecutor('ugc-video', ugcVideoExecutor);
}

export { executeGraph } from './executeGraph.js';
export { subgraphOrder } from './graphOrder.js';
