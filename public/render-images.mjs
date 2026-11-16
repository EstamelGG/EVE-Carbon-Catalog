const preparedImages = new WeakSet();

export function prepareRenderImages(root) {
  for (const image of root.querySelectorAll('img[data-render]')) {
    if (preparedImages.has(image)) continue;
    preparedImages.add(image);
    const preview = image.closest('.render-preview');
    const settle = (state) => {
      preview.dataset.imageState = state;
      preview.setAttribute('aria-busy', 'false');
    };
    const failed = () => {
      if (image.dataset.fallback) {
        const fallback = image.dataset.fallback;
        delete image.dataset.fallback;
        image.src = fallback;
      } else if (image.dataset.icon) {
        const fallback = image.dataset.icon;
        delete image.dataset.icon;
        image.classList.add('official-icon');
        image.src = fallback;
      } else {
        settle('error');
        image.hidden = true;
      }
    };
    const ready = () => {
      settle('ready');
      if (image.hasAttribute('data-equipment') && image.dataset.icon && !preview.querySelector('.equipment-icon')) {
        const icon = document.createElement('img');
        icon.className = 'equipment-icon';
        icon.alt = '';
        icon.hidden = true;
        icon.addEventListener('load', () => { icon.hidden = false; }, { once: true });
        preview.append(icon);
        icon.src = image.dataset.icon;
      }
    };
    image.addEventListener('load', ready);
    image.addEventListener('error', failed);
    // Cached images can finish before the listeners were attached.
    if (image.complete) image.naturalWidth ? ready() : failed();
  }
}
