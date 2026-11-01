// A clip filmed on a green screen (a zombie lurching at the camera), with the green keyed out so
// only the zombie shows over the film, TV or menu behind it. The video plays hidden and each frame
// is drawn onto a canvas through a small WebGL shader that turns green see-through and takes the
// green tinge off the edges (spill). Pictures work the same way, drawn once.
//
// Any green will do: the key is how much greener than red and blue a pixel is, so a lit studio
// green and a darker home-made one both go. No WebGL (it shouldn't happen on the box): the clip
// shows as it is, green and all.

import { onCleanup, onMount } from "solid-js";

const VERTEX = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = vec2((pos.x + 1.0) / 2.0, (1.0 - pos.y) / 2.0);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

// How much greener than the brighter of red and blue a pixel is decides how see-through it is:
// below LOW it's kept (a zombie's greyish-green skin stays), above HIGH it's gone (a green screen,
// even in shadow), in between (hair, motion blur) it's partly there.
const FRAGMENT = `
precision mediump float;
uniform sampler2D frame;
varying vec2 uv;
const float LOW = 0.12;
const float HIGH = 0.22;
void main() {
  vec4 c = texture2D(frame, uv);
  float other = max(c.r, c.b);
  float green = c.g - other;
  float alpha = 1.0 - smoothstep(LOW, HIGH, green);
  // Spill: near the green, what's left can't be much greener than its red or blue, so edges lose
  // the green glow; colours well clear of the green (the zombie's skin) are left alone.
  float spill = smoothstep(0.04, LOW, green);
  vec3 rgb = vec3(c.r, mix(c.g, min(c.g, other + 0.02), spill), c.b);
  gl_FragColor = vec4(rgb * alpha, alpha * c.a);
}`;

/** Draws the source's frames keyed onto the canvas; null when WebGL isn't there. */
function keyer(canvas: HTMLCanvasElement): ((source: HTMLVideoElement | HTMLImageElement, w: number, h: number) => void) | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "pos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.clearColor(0, 0, 0, 0);
  return (source, w, h) => {
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?(cb: () => void): number; cancelVideoFrameCallback?(id: number): void };

/** A green-screen video, keyed. `setup` gets the video to set its volume, looping and ending. */
export function GreenScreenVideo(props: { src: string; setup: (video: HTMLVideoElement) => void }) {
  let canvas!: HTMLCanvasElement;
  let video!: FrameVideo;
  let frame = 0;
  let stopped = false;

  onMount(() => {
    // No WebGL, or a video it won't read (one from another address): show the video itself rather than nothing.
    const plain = () => {
      stopped = true;
      canvas.style.display = "none";
      video.classList.remove("green-source");
      video.classList.add("scare-media");
    };
    const draw = keyer(canvas);
    if (!draw) return plain();
    const next = () => {
      if (stopped) return;
      try {
        if (video.readyState >= 2) draw(video, video.videoWidth, video.videoHeight);
      } catch {
        return plain();
      }
      frame = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(next) : requestAnimationFrame(next);
    };
    next();
  });

  onCleanup(() => {
    stopped = true;
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
  });

  return (
    <>
      <canvas ref={canvas} class="scare-media green-screen" width={16} height={9} />
      <video
        class="green-source"
        src={props.src}
        autoplay
        playsinline
        ref={(el) => {
          video = el as FrameVideo;
          props.setup(el);
        }}
      />
    </>
  );
}

/** A green-screen picture, keyed once it's loaded. */
export function GreenScreenImage(props: { src: string }) {
  let canvas!: HTMLCanvasElement;
  let img!: HTMLImageElement;
  onMount(() => {
    const plain = () => {
      canvas.style.display = "none";
      img.style.display = "";
    };
    const draw = keyer(canvas);
    if (!draw) return plain();
    const go = () => {
      try {
        draw(img, img.naturalWidth, img.naturalHeight);
      } catch {
        plain();
      }
    };
    if (img.complete) go();
    else img.onload = go;
  });
  return (
    <>
      <canvas ref={canvas} class="scare-media green-screen" width={16} height={9} />
      <img ref={img} class="scare-media" src={props.src} alt="" style={{ display: "none" }} />
    </>
  );
}
