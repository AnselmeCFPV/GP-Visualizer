import * as THREE from 'three';

const loader = new THREE.TextureLoader();

export interface SurfaceTextures {
  asphalt: THREE.Texture;
  grass: THREE.Texture;
}

export interface SurfaceTextureUrls {
  asphaltUrl?: string;
  grassUrl?: string;
}

const DEFAULT_ASPHALT_URL = '/textures/asphalt.jpg';
const DEFAULT_GRASS_URL = '/textures/grass.jpg';

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 256,
  repeat = 8,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tryLoadImage(url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (texture) => resolve(texture),
      undefined,
      () => resolve(null),
    );
  });
}

function prepareImageTexture(texture: THREE.Texture, repeat: number): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createGrassTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = '#5a8f50';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 6000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const g = 95 + Math.random() * 55;
      ctx.fillStyle = `rgb(${g - 30},${g},${g - 40})`;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }, 256, 12);
}

export function createAsphaltTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = '#5a5a62';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 8000; i++) {
      const v = 75 + Math.random() * 35;
      ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }
  }, 256, 16);
}

export async function loadSurfaceTextures(urls: SurfaceTextureUrls = {}): Promise<SurfaceTextures> {
  const asphaltCandidates = [urls.asphaltUrl, DEFAULT_ASPHALT_URL, '/textures/asphalt.png'].filter(
    Boolean,
  ) as string[];
  const grassCandidates = [urls.grassUrl, DEFAULT_GRASS_URL, '/textures/grass.png'].filter(
    Boolean,
  ) as string[];

  let asphalt: THREE.Texture | null = null;
  for (const url of asphaltCandidates) {
    asphalt = await tryLoadImage(url);
    if (asphalt) break;
  }
  if (!asphalt) asphalt = createAsphaltTexture();

  let grass: THREE.Texture | null = null;
  for (const url of grassCandidates) {
    grass = await tryLoadImage(url);
    if (grass) break;
  }
  if (!grass) grass = createGrassTexture();

  return {
    asphalt: prepareImageTexture(asphalt, 16),
    grass: prepareImageTexture(grass, 40),
  };
}

export function createMeadowTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = '#5d9a52';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4000; i++) {
      const g = 100 + Math.random() * 40;
      ctx.fillStyle = `rgb(${g - 20},${g + 10},${g - 30})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
  }, 256, 10);
}

export function createForestFloorTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = '#1e3a24';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5000; i++) {
      const g = 25 + Math.random() * 35;
      ctx.fillStyle = `rgb(${g - 8},${g + 15},${g})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random(), 1 + Math.random());
    }
  }, 256, 14);
}

export function createGravelTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = '#c4a574';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 8000; i++) {
      const v = 160 + Math.random() * 60;
      ctx.fillStyle = `rgb(${v},${v - 20},${v - 60})`;
      const r = 0.5 + Math.random() * 1.5;
      ctx.beginPath();
      ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 256, 16);
}

export function createConcreteTexture(): THREE.CanvasTexture {
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = '#9a9a96';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 3000; i++) {
      const v = 130 + Math.random() * 40;
      ctx.fillStyle = `rgb(${v},${v},${v - 5})`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
  }, 256, 6);
}
