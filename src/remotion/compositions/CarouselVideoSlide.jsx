import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {Video} from '@remotion/media';

/**
 * Parameterized carousel slide compositor.
 *
 * Composites a video into the art zone of a rendered carousel slide. The server
 * pre-processes the slide PNG to cut out the zone interior so the video shows
 * through from behind. Zone coords come from render.py (zones.json) so the
 * cutout always matches the visible border, regardless of aspect ratio.
 *
 * Slide: 1080x1350
 *
 * Props:
 *   slidePath — path to the cutout slide PNG (relative to public/)
 *   videoPath — path to the video MP4 (relative to public/)
 *   artZone   — { x, y, w, h } in slide pixel coords (defaults to legacy 1:1 cutout)
 */
export const CarouselVideoSlide = ({slidePath, videoPath, artZone}) => {
  const slide = slidePath ? staticFile(slidePath) : staticFile('carousel-video/slide_2_cutout.png');
  const video = videoPath ? staticFile(videoPath) : staticFile('carousel-video/paper_fold.mp4');
  const zone = artZone || {x: 192, y: 182, w: 696, h: 696};

  return (
    <AbsoluteFill style={{backgroundColor: '#0a0a0f'}}>
      {/* Video layer — fills the zone behind the slide's cutout */}
      <Video
        src={video}
        muted
        loop
        style={{
          position: 'absolute',
          left: zone.x,
          top: zone.y,
          width: zone.w,
          height: zone.h,
          objectFit: 'cover',
        }}
      />

      {/* Slide overlay with transparent zone — video shows through */}
      <Img
        src={slide}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1080,
          height: 1350,
        }}
      />
    </AbsoluteFill>
  );
};
