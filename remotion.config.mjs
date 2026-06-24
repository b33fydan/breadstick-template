import {Config} from '@remotion/cli/config';

Config.setEntryPoint('./src/remotion/index.jsx');

// Enable angle GL renderer for compositions that use HtmlInCanvas with WebGL
// shaders (e.g., AsciiPlanetShader CRT effect). Required for `<HtmlInCanvas>`
// onPaint callbacks that use gl.texElementImage2D + fragment shaders.
// Switch to 'swangle' on machines without a GPU.
Config.setChromiumOpenGlRenderer('angle');
