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
  const ripples = [];
  let canvasWidth = 0;
  let canvasHeight = 0;
  let pixelRatio = 1;
  let lastRippleAt = 0;

  canvas.className = "ambient-ripple-canvas";
  document.body.prepend(canvas);

  function resizeRippleCanvas() {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvasWidth = window.innerWidth;
    canvasHeight = window.innerHeight;
    canvas.width = Math.round(canvasWidth * pixelRatio);
    canvas.height = Math.round(canvasHeight * pixelRatio);
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function addRipple(x, y, strength = 1) {
    ripples.push({
      x,
      y,
      age: 0,
      radius: 10,
      strength: Math.min(Math.max(strength, 0.55), 1.45)
    });
    if (ripples.length > 18) ripples.shift();
  }

  function drawRippleFrame(now) {
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.globalCompositeOperation = "screen";

    const time = now * 0.001;
    for (let line = 0; line < 5; line += 1) {
      const baseY = canvasHeight * (0.18 + line * 0.18);
      context.beginPath();
      for (let x = -40; x <= canvasWidth + 40; x += 28) {
        const y = baseY
          + Math.sin(x * 0.008 + time * 0.82 + line * 1.4) * 11
          + Math.sin(x * 0.015 - time * 0.48) * 5;
        if (x === -40) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = `rgba(255, 255, 255, ${0.022 + line * 0.004})`;
      context.lineWidth = 1;
      context.stroke();
    }

    for (let index = ripples.length - 1; index >= 0; index -= 1) {
      const ripple = ripples[index];
      ripple.age += 1;
      ripple.radius += 3.2 + ripple.strength * 1.6;
      const opacity = Math.max(0, 1 - ripple.age / 90) * 0.16 * ripple.strength;
      if (opacity <= 0.004) {
        ripples.splice(index, 1);
        continue;
      }

      const gradient = context.createRadialGradient(ripple.x, ripple.y, Math.max(0, ripple.radius - 18), ripple.x, ripple.y, ripple.radius + 28);
      gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
      gradient.addColorStop(0.46, `rgba(255, 255, 255, ${opacity})`);
      gradient.addColorStop(0.64, `rgba(10, 132, 255, ${opacity * 0.38})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.beginPath();
      context.arc(ripple.x, ripple.y, ripple.radius + 28, 0, Math.PI * 2);
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      context.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
      context.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.92})`;
      context.lineWidth = 1;
      context.stroke();
    }

    context.globalCompositeOperation = "source-over";
    window.requestAnimationFrame(drawRippleFrame);
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
    const now = window.performance.now();
    if (now - lastRippleAt > 70) {
      const movement = Math.hypot(event.movementX || 0, event.movementY || 0);
      addRipple(event.clientX, event.clientY, 0.65 + movement / 46);
      lastRippleAt = now;
    }
    scheduleAmbientUpdate();
  }, { passive: true });

  window.addEventListener("scroll", () => {
    scrollY = window.scrollY;
    scheduleAmbientUpdate();
  }, { passive: true });

  window.addEventListener("resize", resizeRippleCanvas, { passive: true });

  resizeRippleCanvas();
  updateAmbientBackground();
  window.requestAnimationFrame(drawRippleFrame);
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
