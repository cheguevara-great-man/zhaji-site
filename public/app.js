document.addEventListener("submit", (event) => {
  const form = event.target;
  const message = form.getAttribute("data-confirm");
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduceMotion) {
  const root = document.documentElement;
  const pointer = { x: 50, y: 18 };
  const targetPointer = { x: 50, y: 18 };
  let scrollY = window.scrollY;
  let scheduled = false;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: true });
  let canvasWidth = 0;
  let canvasHeight = 0;
  let pixelRatio = 1;
  const wind = { x: 1, y: 0, energy: 0 };
  const targetWind = { x: 1, y: 0, energy: 0 };

  canvas.className = "ambient-lake-canvas";
  document.body.prepend(canvas);

  function resizeLakeCanvas() {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;
    canvas.width = Math.round(canvasWidth * pixelRatio);
    canvas.height = Math.round(canvasHeight * pixelRatio);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function drawLakeFrame(now) {
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.globalCompositeOperation = "source-over";

    const time = now * 0.001;
    wind.x += (targetWind.x - wind.x) * 0.035;
    wind.y += (targetWind.y - wind.y) * 0.035;
    wind.energy += (targetWind.energy - wind.energy) * 0.055;
    targetWind.energy *= 0.986;

    const speed = 0.8 + wind.energy * 2.1;
    const tilt = Math.max(-0.42, Math.min(0.42, wind.y * 0.38));
    const drift = time * (28 + wind.x * 20) * speed;
    const rowGap = Math.max(18, Math.min(30, canvasHeight / 34));
    const columnGap = Math.max(58, Math.min(98, canvasWidth / 15));

    for (let row = -1; row < canvasHeight / rowGap + 2; row += 1) {
      const baseY = row * rowGap;
      const rowPhase = row * 0.77;
      const waveLift = Math.sin(time * 0.58 + rowPhase) * (6 + wind.energy * 14);

      context.beginPath();
      for (let x = -80; x <= canvasWidth + 80; x += 26) {
        const y = baseY
          + waveLift
          + Math.sin((x + drift) * 0.009 + rowPhase) * (7 + wind.energy * 9)
          + Math.sin((x - drift * 0.62) * 0.017 - rowPhase) * 3;
        if (x === -80) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = `rgba(27, 107, 128, ${0.026 + wind.energy * 0.05})`;
      context.lineWidth = 0.8 + wind.energy * 0.35;
      context.stroke();

      for (let col = -1; col < canvasWidth / columnGap + 2; col += 1) {
        const seed = row * 17.13 + col * 31.7;
        const shimmer = Math.sin(time * (1.4 + (seed % 5) * 0.11) + seed);
        if (shimmer < 0.18 - wind.energy * 0.38) continue;

        const x = col * columnGap
          + Math.sin(time * 0.36 + seed) * 34
          + (drift % columnGap)
          - columnGap;
        const y = baseY
          + waveLift
          + Math.sin((x + drift) * 0.009 + rowPhase) * (7 + wind.energy * 9);
        const length = 18 + wind.energy * 48 + Math.max(0, shimmer) * 20;
        const alpha = (0.018 + Math.max(0, shimmer) * 0.055) * (0.75 + wind.energy * 1.15);

        const gradient = context.createLinearGradient(x - length / 2, y, x + length / 2, y + tilt * length);
        gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
        gradient.addColorStop(0.32, `rgba(31, 132, 150, ${alpha * 0.22})`);
        gradient.addColorStop(0.52, `rgba(255, 255, 255, ${alpha})`);
        gradient.addColorStop(0.7, `rgba(18, 100, 124, ${alpha * 0.18})`);
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

        context.beginPath();
        context.moveTo(x - length / 2, y);
        context.quadraticCurveTo(x, y + tilt * length * 0.34, x + length / 2, y + tilt * length);
        context.strokeStyle = gradient;
        context.lineWidth = 0.9 + wind.energy * 0.75;
        context.stroke();
      }
    }

    if (wind.energy > 0.08) {
      const sheen = context.createLinearGradient(0, canvasHeight * 0.18, canvasWidth, canvasHeight * 0.72);
      sheen.addColorStop(0, "rgba(255, 255, 255, 0)");
      sheen.addColorStop(0.45, `rgba(255, 255, 255, ${wind.energy * 0.06})`);
      sheen.addColorStop(0.62, `rgba(26, 113, 137, ${wind.energy * 0.026})`);
      sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.beginPath();
      context.rect(0, 0, canvasWidth, canvasHeight);
      context.fillStyle = sheen;
      context.fill();
    }

    context.globalCompositeOperation = "source-over";
    window.requestAnimationFrame(drawLakeFrame);
  }

  function updateAmbientBackground() {
    scheduled = false;
    pointer.x += (targetPointer.x - pointer.x) * 0.08;
    pointer.y += (targetPointer.y - pointer.y) * 0.08;
    const shift = Math.max(-120, Math.min(160, scrollY * 0.08));
    root.style.setProperty("--pointer-x", `${pointer.x}%`);
    root.style.setProperty("--pointer-y", `${pointer.y}%`);
    root.style.setProperty("--scroll-shift", `${shift}px`);
    root.style.setProperty("--glow-rotate", `${scrollY * 0.018}deg`);
    root.style.setProperty("--glow-drift-x", `${(pointer.x - 50) * 0.9}px`);
    root.style.setProperty("--glow-drift-y", `${(pointer.y - 50) * 0.7}px`);
    if (Math.abs(targetPointer.x - pointer.x) > 0.08 || Math.abs(targetPointer.y - pointer.y) > 0.08) {
      scheduleAmbientUpdate();
    }
  }

  function scheduleAmbientUpdate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateAmbientBackground);
  }

  window.addEventListener("pointermove", (event) => {
    targetPointer.x = 42 + ((event.clientX / window.innerWidth) - 0.5) * 22;
    targetPointer.y = 24 + ((event.clientY / window.innerHeight) - 0.5) * 18;
    const movement = Math.hypot(event.movementX || 0, event.movementY || 0);
    if (movement > 0) {
      targetWind.x = (event.movementX || 0) / movement;
      targetWind.y = (event.movementY || 0) / movement;
      targetWind.energy = Math.min(1, Math.max(targetWind.energy, movement / 34));
    }
    scheduleAmbientUpdate();
  }, { passive: true });

  window.addEventListener("scroll", () => {
    scrollY = window.scrollY;
    scheduleAmbientUpdate();
  }, { passive: true });

  window.addEventListener("resize", resizeLakeCanvas, { passive: true });

  resizeLakeCanvas();
  updateAmbientBackground();
  window.requestAnimationFrame(drawLakeFrame);
}

const feed = document.querySelector("[data-feed]");
const sentinel = document.querySelector("[data-feed-sentinel]");

if (feed && sentinel) {
  let loading = false;

  async function loadMoreArticles() {
    if (loading || feed.dataset.hasMore !== "true") return;
    loading = true;
    sentinel.textContent = "加载中...";

    try {
      const offset = Number.parseInt(feed.dataset.nextOffset || "0", 10);
      const limit = Number.parseInt(feed.dataset.pageSize || "12", 10);
      const response = await fetch(`/api/articles?offset=${offset}&limit=${limit}`, {
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error("Failed to load articles.");

      const result = await response.json();
      feed.insertAdjacentHTML("beforeend", result.html);
      feed.dataset.nextOffset = String(result.nextOffset);
      feed.dataset.hasMore = result.hasMore ? "true" : "false";
      sentinel.textContent = result.hasMore ? "继续向下滚动" : "已经到底了";
    } catch {
      sentinel.textContent = "加载失败，向下滚动重试";
    } finally {
      loading = false;
    }
  }

  if (feed.dataset.hasMore === "true" && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMoreArticles();
      }
    }, { rootMargin: "500px 0px" });
    observer.observe(sentinel);
  } else if (feed.dataset.hasMore !== "true") {
    sentinel.textContent = "已经到底了";
  }
}

const prose = document.querySelector(".prose");

if (prose) {
  const lightbox = document.createElement("div");
  lightbox.className = "image-lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Image preview");
  lightbox.hidden = true;
  lightbox.innerHTML = `
    <button class="image-lightbox-close" type="button" aria-label="Close image">×</button>
    <img class="image-lightbox-img" alt="">
  `;
  document.body.append(lightbox);

  const lightboxImage = lightbox.querySelector(".image-lightbox-img");
  const closeButton = lightbox.querySelector(".image-lightbox-close");
  let lastFocusedElement = null;

  function openImageLightbox(image) {
    lastFocusedElement = document.activeElement;
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt || "";
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");
    closeButton.focus();
  }

  function closeImageLightbox() {
    if (lightbox.hidden) return;
    lightbox.hidden = true;
    lightboxImage.removeAttribute("src");
    document.body.classList.remove("lightbox-open");
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }

  for (const image of prose.querySelectorAll("img")) {
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "Open image preview");
  }

  prose.addEventListener("click", (event) => {
    const image = event.target.closest(".prose img");
    if (image) openImageLightbox(image);
  });

  prose.addEventListener("keydown", (event) => {
    const image = event.target.closest(".prose img");
    if (!image || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openImageLightbox(image);
  });

  closeButton.addEventListener("click", closeImageLightbox);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeImageLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageLightbox();
  });
}
