// Exercise GIFs: a link ("https://…") or an upload ("media:<id>", stored by
// store.media in the data repo and mirrored offline). One file, shown at
// different sizes by CSS: a card on the exercise page, a small thumb in each
// variant row, and full width in the lightbox when tapped.

import { media } from '../storage/store.js';
import { processDocument } from '../../ghsync/blobs.js';
import { el } from './components.js';

export const MAX_GIF_BYTES = 5 * 1024 * 1024;
export const isUpload = (ref) => typeof ref === 'string' && ref.startsWith('media:');
const isLink = (ref) => typeof ref === 'string' && /^https?:\/\//i.test(ref.trim());
export const hasGif = (ref) => isUpload(ref) || isLink(ref);

// Resolve a gif reference to something an <img> can show (null if not yet
// available: an upload this device hasn't downloaded while offline).
export async function gifSrc(ref) {
  if (isLink(ref)) return ref.trim();
  if (isUpload(ref)) return (await media.urls(ref.slice('media:'.length)))?.full ?? null;
  return null;
}

// An <img> that fills in once resolved; tap opens the lightbox.
export function gifImage(ref, { cls = 'gif-card', alt = '', lightbox = true } = {}) {
  const img = el('img', { class: cls, alt, loading: 'lazy', decoding: 'async' });
  const wrap = el('button', {
    class: `gif-wrap ${cls}-wrap`, type: 'button', 'aria-label': alt ? `Show ${alt} larger` : 'Show larger',
    onclick: (e) => { e.stopPropagation(); if (lightbox) openLightbox(ref, alt); },
  }, img);
  gifSrc(ref).then((src) => {
    if (src) img.src = src;
    else wrap.classList.add('gif-missing');
  });
  img.addEventListener('error', () => wrap.classList.add('gif-missing'));
  return wrap;
}

// Full-size (or screen-width) view. Tap anywhere or Escape to close.
export function openLightbox(ref, alt = '') {
  const img = el('img', { class: 'lightbox-img', alt });
  const close = () => { box.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = el('div', { class: 'lightbox', role: 'dialog', 'aria-label': alt || 'Exercise animation', onclick: close },
    img,
    alt && el('div', { class: 'lightbox-caption' }, alt),
    el('button', { class: 'lightbox-x', type: 'button', 'aria-label': 'Close', onclick: close }, '✕'));
  document.body.appendChild(box);
  addEventListener('keydown', onKey);
  gifSrc(ref).then((src) => { if (src) img.src = src; });
}

// A picked file -> "media:<id>". Images only (a GIF, or an animated WebP).
export async function uploadGif(file) {
  if (!file.type.startsWith('image/') && !/\.(gif|webp|png|jpe?g)$/i.test(file.name)) {
    throw new Error(`${file.name} isn’t an image`);
  }
  if (file.size > MAX_GIF_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB — the limit is 5 MB. Shrink it, or link to it instead.`);
  }
  const processed = await processDocument(file);
  if (!processed.mime.startsWith('image/')) processed.mime = 'image/gif';
  return `media:${await media.add(processed)}`;
}

// A linked GIF -> "media:<id>": a copy kept with your data (offline, and
// safe from the link breaking). The browser can only read another site's
// image when that site allows it (CORS); many do, some don't — then the way
// is to save the image on the phone and upload it.
export async function copyLinkedGif(url) {
  let res;
  try {
    res = await fetch(url.trim(), { cache: 'no-store' });
  } catch {
    throw new Error('That site doesn’t let other web apps copy its images. Save the GIF to your phone (long-press it), then use Upload GIF…');
  }
  if (!res.ok) throw new Error(`Couldn’t get the GIF (the site answered ${res.status}). Check the link.`);
  const blob = await res.blob();
  if (blob.type && !blob.type.startsWith('image/')) {
    throw new Error('That link is a web page, not an image. Open it, long-press the GIF and choose “Copy Link” or “Copy Image Address”.');
  }
  const name = decodeURIComponent(new URL(url.trim()).pathname.split('/').pop() || '') || 'exercise.gif';
  return uploadGif(new File([blob], name, { type: blob.type || 'image/gif' }));
}

export function removeUpload(ref) {
  if (isUpload(ref)) media.remove(ref.slice('media:'.length));
}
