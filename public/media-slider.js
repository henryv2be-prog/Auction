(function setupMediaSlider() {
  const slider = document.querySelector("[data-media-slider]");
  if (!slider) {
    return;
  }

  const track = slider.querySelector("[data-media-track]");
  const slides = Array.from(slider.querySelectorAll("[data-media-slide]"));
  const previousButton = slider.querySelector("[data-media-prev]");
  const nextButton = slider.querySelector("[data-media-next]");
  const dots = Array.from(slider.querySelectorAll("[data-media-dot]"));
  const counter = slider.querySelector("[data-media-counter]");
  const caption = slider.querySelector("[data-media-caption]");
  const lightbox = slider.querySelector("[data-media-overlay]");
  const lightboxBody = slider.querySelector(".media-modal-media");
  const lightboxCaption = slider.querySelector("[data-overlay-title]");
  const lightboxClose = slider.querySelector("[data-overlay-close]");
  const lightboxPrev = slider.querySelector("[data-overlay-prev]");
  const lightboxNext = slider.querySelector("[data-overlay-next]");
  let currentIndex = 0;
  let lightboxIndex = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  /** Suppress accidental click right after a horizontal swipe (ghost clicks on touch devices). */
  let lastSwipeGestureAt = 0;

  if (!track || !slides.length) {
    return;
  }

  function pauseAllVideosExcept(activeIndex) {
    slides.forEach((slide, idx) => {
      const video = slide.querySelector("video");
      if (!video) {
        return;
      }
      if (idx !== activeIndex) {
        video.pause();
      }
    });
  }

  function getSlideMeta(index) {
    const slide = slides[index];
    return {
      type: slide.dataset.mediaType || "image",
      src: slide.dataset.mediaSrc || "",
      title: slide.dataset.mediaTitle || `Media ${index + 1}`
    };
  }

  function setIndex(index) {
    currentIndex = Math.max(0, Math.min(index, slides.length - 1));
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    pauseAllVideosExcept(currentIndex);

    if (counter) {
      counter.textContent = `${currentIndex + 1} / ${slides.length}`;
    }

    if (caption) {
      caption.textContent = getSlideMeta(currentIndex).title;
    }

    dots.forEach((dot, dotIndex) => {
      const active = dotIndex === currentIndex;
      dot.classList.toggle("active", active);
      dot.setAttribute("aria-selected", active ? "true" : "false");
      dot.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  function move(delta) {
    setIndex(currentIndex + delta);
  }

  function openLightbox(index) {
    if (!lightbox || !lightboxBody || !lightboxCaption) {
      return;
    }

    slides.forEach((slide) => {
      const video = slide.querySelector("video");
      if (video) {
        video.pause();
      }
    });

    lightboxIndex = Math.max(0, Math.min(index, slides.length - 1));
    const media = getSlideMeta(lightboxIndex);

    lightboxBody.innerHTML = "";
    if (media.type === "video") {
      const video = document.createElement("video");
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.preload = "metadata";
      const sourceEl = document.createElement("source");
      sourceEl.src = media.src;
      video.appendChild(sourceEl);
      lightboxBody.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = media.src;
      img.alt = media.title;
      lightboxBody.appendChild(img);
    }

    lightboxCaption.textContent = `${lightboxIndex + 1} / ${slides.length} - ${media.title}`;
    lightbox.hidden = false;
    lightbox.classList.add("open");
    document.body.classList.add("overlay-open");
  }

  function closeLightbox() {
    if (!lightbox || !lightboxBody) {
      return;
    }

    const video = lightboxBody.querySelector("video");
    if (video) {
      video.pause();
    }
    lightboxBody.innerHTML = "";
    lightbox.hidden = true;
    lightbox.classList.remove("open");
    document.body.classList.remove("overlay-open");
  }

  function moveLightbox(delta) {
    if (!lightbox || lightbox.hidden) {
      return;
    }
    let nextIndex = lightboxIndex + delta;
    if (nextIndex < 0) {
      nextIndex = slides.length - 1;
    } else if (nextIndex >= slides.length) {
      nextIndex = 0;
    }
    openLightbox(nextIndex);
  }

  previousButton?.addEventListener("click", () => move(-1));
  nextButton?.addEventListener("click", () => move(1));

  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => setIndex(index));
  });

  function shouldIgnoreSlideClick() {
    return Date.now() - lastSwipeGestureAt < 450;
  }

  slides.forEach((slide, index) => {
    slide.addEventListener("click", (event) => {
      if (shouldIgnoreSlideClick()) {
        return;
      }
      const video = slide.querySelector("video");
      if (video && event.target instanceof HTMLVideoElement) {
        return;
      }
      event.preventDefault();
      openLightbox(index);
    });
    slide.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openLightbox(index);
      }
    });
  });

  track.addEventListener(
    "touchstart",
    (event) => {
      if (!event.touches || !event.touches.length) {
        return;
      }
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    },
    { passive: true }
  );

  track.addEventListener(
    "touchend",
    (event) => {
      if (!event.changedTouches || !event.changedTouches.length) {
        return;
      }
      const deltaX = event.changedTouches[0].clientX - touchStartX;
      const deltaY = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) < 40 || Math.abs(deltaX) < Math.abs(deltaY)) {
        return;
      }
      lastSwipeGestureAt = Date.now();
      if (deltaX < 0) {
        move(1);
      } else {
        move(-1);
      }
    },
    { passive: true }
  );

  if (lightbox) {
    lightboxClose?.addEventListener("click", closeLightbox);
    lightboxPrev?.addEventListener("click", () => moveLightbox(-1));
    lightboxNext?.addEventListener("click", () => moveLightbox(1));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) {
        closeLightbox();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (lightbox.hidden) {
        return;
      }
      if (event.key === "Escape") {
        closeLightbox();
      } else if (event.key === "ArrowLeft") {
        moveLightbox(-1);
      } else if (event.key === "ArrowRight") {
        moveLightbox(1);
      }
    });
  }

  setIndex(0);
})();
