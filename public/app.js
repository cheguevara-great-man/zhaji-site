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
  const lakeBoats = [
    { x: 0.36, y: 0.15, scale: 0.82, speed: 0.018, phase: 0.4 },
    { x: 0.82, y: 0.34, scale: 0.62, speed: -0.014, phase: 2.1 }
  ];
  const lakeLife = [
    { x: 0.18, y: 0.72, scale: 0.72, speed: 0.028, phase: 0.2, kind: "fish" },
    { x: 0.58, y: 0.37, scale: 0.56, speed: -0.02, phase: 1.5, kind: "fish" },
    { x: 0.86, y: 0.82, scale: 0.48, speed: -0.017, phase: 3.2, kind: "shrimp" },
    { x: 0.39, y: 0.54, scale: 0.42, speed: 0.022, phase: 4.1, kind: "shrimp" }
  ];

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

  function wrapCanvasX(value, margin) {
    const span = canvasWidth + margin * 2;
    return ((value + margin) % span + span) % span - margin;
  }

  function drawBoat(boat, time, drift) {
    const scale = boat.scale * Math.max(0.82, Math.min(1.18, canvasWidth / 1320));
    const x = wrapCanvasX(canvasWidth * boat.x + time * boat.speed * canvasWidth + wind.x * drift * 0.05, 90 * scale);
    const y = canvasHeight * boat.y + Math.sin(time * 0.72 + boat.phase) * 7 + wind.y * 10;
    const width = 66 * scale;
    const height = 44 * scale;

    context.save();
    context.translate(x, y);
    context.globalAlpha = 0.34;
    context.fillStyle = "rgba(18, 74, 91, 0.9)";
    context.beginPath();
    context.moveTo(-width * 0.48, height * 0.08);
    context.quadraticCurveTo(-width * 0.2, height * 0.34, width * 0.18, height * 0.28);
    context.quadraticCurveTo(width * 0.44, height * 0.22, width * 0.52, height * 0.02);
    context.lineTo(-width * 0.48, height * 0.02);
    context.closePath();
    context.fill();

    context.strokeStyle = "rgba(17, 84, 104, 0.64)";
    context.lineWidth = 1.1 * scale;
    context.beginPath();
    context.moveTo(0, height * 0.03);
    context.lineTo(0, -height * 0.88);
    context.stroke();

    context.fillStyle = "rgba(255, 255, 255, 0.58)";
    context.beginPath();
    context.moveTo(2 * scale, -height * 0.82);
    context.quadraticCurveTo(width * 0.34, -height * 0.38, 4 * scale, -height * 0.04);
    context.closePath();
    context.fill();

    context.globalAlpha = 0.18;
    const reflection = context.createLinearGradient(-width * 0.7, height * 0.42, width * 0.7, height * 0.42);
    reflection.addColorStop(0, "rgba(255, 255, 255, 0)");
    reflection.addColorStop(0.5, "rgba(20, 91, 112, 0.55)");
    reflection.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.strokeStyle = reflection;
    context.lineWidth = 5 * scale;
    context.beginPath();
    context.moveTo(-width * 0.62, height * 0.44);
    context.quadraticCurveTo(0, height * 0.5 + Math.sin(time + boat.phase) * 3, width * 0.64, height * 0.42);
    context.stroke();
    context.restore();
  }

  function drawFish(life, time, drift) {
    const direction = life.speed >= 0 ? 1 : -1;
    const scale = life.scale * Math.max(0.78, Math.min(1.12, canvasWidth / 1280));
    const x = wrapCanvasX(canvasWidth * life.x + time * life.speed * canvasWidth + wind.x * drift * 0.028, 70 * scale);
    const y = canvasHeight * life.y + Math.sin(time * 1.1 + life.phase) * 14 + wind.y * 8;
    const bodyLength = (life.kind === "shrimp" ? 24 : 34) * scale;
    const bodyHeight = (life.kind === "shrimp" ? 8 : 12) * scale;

    context.save();
    context.translate(x, y);
    context.scale(direction, 1);
    context.globalAlpha = life.kind === "shrimp" ? 0.3 : 0.28;
    context.strokeStyle = "rgba(12, 87, 109, 0.72)";
    context.fillStyle = "rgba(18, 105, 128, 0.42)";
    context.lineWidth = 1.15 * scale;

    if (life.kind === "shrimp") {
      context.beginPath();
      context.arc(0, 0, bodyLength * 0.42, Math.PI * 0.08, Math.PI * 1.12, false);
      context.stroke();
      context.beginPath();
      context.moveTo(-bodyLength * 0.42, -bodyHeight * 0.28);
      context.lineTo(-bodyLength * 0.64, -bodyHeight * 0.72);
      context.moveTo(-bodyLength * 0.42, bodyHeight * 0.16);
      context.lineTo(-bodyLength * 0.64, bodyHeight * 0.62);
      context.stroke();
    } else {
      context.beginPath();
      context.ellipse(0, 0, bodyLength * 0.42, bodyHeight * 0.5, 0, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(-bodyLength * 0.42, 0);
      context.lineTo(-bodyLength * 0.68, -bodyHeight * 0.48);
      context.lineTo(-bodyLength * 0.68, bodyHeight * 0.48);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(bodyLength * 0.12, 0);
      context.quadraticCurveTo(bodyLength * 0.32, -bodyHeight * 0.26, bodyLength * 0.45, -bodyHeight * 0.06);
      context.stroke();
    }

    context.restore();
  }

  function drawLakeFrame(now) {
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.globalCompositeOperation = "source-over";

    const time = now * 0.001;
    wind.x += (targetWind.x - wind.x) * 0.035;
    wind.y += (targetWind.y - wind.y) * 0.035;
    wind.energy += (targetWind.energy - wind.energy) * 0.055;
    targetWind.energy *= 0.986;

    const speed = 0.72 + wind.energy * 2.5;
    const windLift = Math.max(-0.5, Math.min(0.5, wind.y));
    const drift = time * (34 + wind.x * 24) * speed;
    const water = context.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    water.addColorStop(0, "rgba(214, 238, 255, 0.5)");
    water.addColorStop(0.38, "rgba(172, 224, 225, 0.44)");
    water.addColorStop(0.72, "rgba(226, 242, 213, 0.34)");
    water.addColorStop(1, "rgba(248, 243, 220, 0.26)");
    context.fillStyle = water;
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    const glowA = context.createRadialGradient(canvasWidth * 0.28, canvasHeight * 0.24, 0, canvasWidth * 0.28, canvasHeight * 0.24, canvasWidth * 0.62);
    glowA.addColorStop(0, "rgba(98, 190, 226, 0.2)");
    glowA.addColorStop(0.62, "rgba(98, 190, 226, 0.07)");
    glowA.addColorStop(1, "rgba(98, 190, 226, 0)");
    context.fillStyle = glowA;
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    const glowB = context.createRadialGradient(canvasWidth * 0.78, canvasHeight * 0.5, 0, canvasWidth * 0.78, canvasHeight * 0.5, canvasWidth * 0.56);
    glowB.addColorStop(0, "rgba(105, 201, 164, 0.16)");
    glowB.addColorStop(0.64, "rgba(105, 201, 164, 0.06)");
    glowB.addColorStop(1, "rgba(105, 201, 164, 0)");
    context.fillStyle = glowB;
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    context.filter = "blur(13px)";
    context.globalCompositeOperation = "multiply";
    for (let band = 0; band < 9; band += 1) {
      const phase = band * 1.19;
      const bandY = canvasHeight * (-0.08 + band * 0.145)
        + Math.sin(time * 0.42 + phase) * 28
        + windLift * 34;
      const bandHeight = 70 + Math.sin(phase) * 18 + wind.energy * 28;

      context.beginPath();
      context.moveTo(-120, bandY);
      for (let x = -120; x <= canvasWidth + 140; x += 95) {
        const y = bandY
          + Math.sin((x + drift * 1.25) * 0.006 + phase) * (32 + wind.energy * 24)
          + Math.sin((x - drift * 0.68) * 0.013 - phase) * 12;
        context.lineTo(x, y);
      }
      for (let x = canvasWidth + 140; x >= -120; x -= 95) {
        const y = bandY + bandHeight
          + Math.sin((x + drift * 0.9) * 0.006 + phase + 1.8) * (34 + wind.energy * 22)
          + Math.sin((x - drift * 0.55) * 0.014 - phase) * 10;
        context.lineTo(x, y);
      }
      context.closePath();
      context.fillStyle = band % 2 === 0
        ? `rgba(38, 126, 154, ${0.055 + wind.energy * 0.025})`
        : `rgba(46, 156, 126, ${0.04 + wind.energy * 0.022})`;
      context.fill();
    }

    context.filter = "blur(7px)";
    context.globalCompositeOperation = "screen";
    for (let band = 0; band < 11; band += 1) {
      const phase = band * 0.83 + 1.7;
      const bandY = canvasHeight * (0.02 + band * 0.105)
        + Math.cos(time * 0.48 + phase) * 20
        - windLift * 22;
      const highlight = context.createLinearGradient(0, bandY - 36, canvasWidth, bandY + 36);
      highlight.addColorStop(0, "rgba(255, 255, 255, 0)");
      highlight.addColorStop(0.52, `rgba(255, 255, 255, ${0.08 + wind.energy * 0.08})`);
      highlight.addColorStop(1, "rgba(255, 255, 255, 0)");

      context.beginPath();
      context.moveTo(-140, bandY);
      for (let x = -140; x <= canvasWidth + 160; x += 82) {
        const y = bandY
          + Math.sin((x + drift * 1.55) * 0.008 + phase) * (20 + wind.energy * 25)
          + Math.sin((x - drift * 0.9) * 0.021 + phase * 0.7) * 7;
        context.lineTo(x, y);
      }
      context.strokeStyle = highlight;
      context.lineWidth = 18 + wind.energy * 18;
      context.stroke();
    }

    context.filter = "none";
    context.globalCompositeOperation = "source-over";
    for (const life of lakeLife) {
      drawFish(life, time, drift);
    }
    for (const boat of lakeBoats) {
      drawBoat(boat, time, drift);
    }

    context.filter = "none";
    context.globalCompositeOperation = "screen";
    const rowGap = Math.max(21, Math.min(36, canvasHeight / 28));
    const columnGap = Math.max(74, Math.min(128, canvasWidth / 13));
    for (let row = -1; row < canvasHeight / rowGap + 2; row += 1) {
      const baseY = row * rowGap;
      const rowPhase = row * 0.77;
      const waveLift = Math.sin(time * 0.58 + rowPhase) * (6 + wind.energy * 15);

      for (let col = -1; col < canvasWidth / columnGap + 2; col += 1) {
        const seed = row * 17.13 + col * 31.7;
        const shimmer = Math.sin(time * (1.35 + (seed % 5) * 0.12) + seed);
        if (shimmer < 0.04 - wind.energy * 0.42) continue;

        const x = col * columnGap
          + Math.sin(time * 0.36 + seed) * 44
          + (drift % columnGap)
          - columnGap;
        const y = baseY
          + waveLift
          + Math.sin((x + drift) * 0.009 + rowPhase) * (9 + wind.energy * 13);
        const length = 32 + wind.energy * 62 + Math.max(0, shimmer) * 28;
        const alpha = (0.028 + Math.max(0, shimmer) * 0.07) * (0.8 + wind.energy * 1.2);
        const tilt = Math.max(-0.55, Math.min(0.55, wind.y * 0.42));
        const gradient = context.createLinearGradient(x - length / 2, y, x + length / 2, y + tilt * length);
        gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
        gradient.addColorStop(0.46, `rgba(255, 255, 255, ${alpha})`);
        gradient.addColorStop(0.58, `rgba(142, 234, 244, ${alpha * 0.32})`);
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

        context.beginPath();
        context.moveTo(x - length / 2, y);
        context.quadraticCurveTo(x, y + tilt * length * 0.34, x + length / 2, y + tilt * length);
        context.strokeStyle = gradient;
        context.lineWidth = 1.35 + wind.energy * 1.4;
        context.stroke();
      }
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
