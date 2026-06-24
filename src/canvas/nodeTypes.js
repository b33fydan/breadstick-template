import CharacterNode from './nodes/CharacterNode';
import PainPointNode from './nodes/PainPointNode';
import HookNode from './nodes/HookNode';
import ScriptTypeNode from './nodes/ScriptTypeNode';
import ConversionLevelNode from './nodes/ConversionLevelNode';
import ScriptGeneratorNode from './nodes/ScriptGeneratorNode';
import VoiceNode from './nodes/VoiceNode';
import ImageNode from './nodes/ImageNode';
import VideoNode from './nodes/VideoNode';
import CaptionNode from './nodes/CaptionNode';

export const nodeTypes = {
  character: CharacterNode,
  painPoint: PainPointNode,
  hook: HookNode,
  scriptType: ScriptTypeNode,
  conversionLevel: ConversionLevelNode,
  scriptGenerator: ScriptGeneratorNode,
  voice: VoiceNode,
  image: ImageNode,
  video: VideoNode,
  caption: CaptionNode,
};
