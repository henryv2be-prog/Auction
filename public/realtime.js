(function setupRealtimeAuctionUpdates() {
  if (typeof io === "undefined") {
    return;
  }

  const root = document.querySelector("[data-realtime-root]");
  if (!root) {
    return;
  }

  const mode = root.dataset.mode;
  const socket = io();

  if (mode === "detail") {
    const assetId = Number(root.dataset.assetId);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      return;
    }

    socket.emit("asset:subscribe", assetId);
    window.addEventListener("beforeunload", () => {
      socket.emit("asset:unsubscribe", assetId);
    });

    socket.on("asset:update", (payload) => {
      if (!payload || payload.assetId !== assetId) {
        return;
      }
      applyDetailUpdate(root, payload);
    });

    return;
  }

  if (mode === "listing") {
    socket.on("asset:listing-update", (payload) => {
      if (!payload || !payload.assetId) {
        return;
      }
      applyListingUpdate(payload);
    });
    return;
  }

  socket.disconnect();
})();

function applyDetailUpdate(root, payload) {
  const currentPriceEl = root.querySelector("[data-current-price]");
  if (currentPriceEl) {
    currentPriceEl.textContent = formatCurrency(payload.currentPrice);
  }

  const minimumBidHintEl = root.querySelector("[data-minimum-bid]");
  if (minimumBidHintEl) {
    minimumBidHintEl.textContent = formatCurrency(payload.currentPrice);
  }

  const statusPillEl = root.querySelector("[data-asset-status-pill]");
  if (statusPillEl) {
    setStatusPill(statusPillEl, payload.status);
  }

  const bidTableBodyEl = root.querySelector("[data-bids-body]");
  const bidEmptyEl = root.querySelector("[data-bids-empty]");
  if (payload.latestBid && bidTableBodyEl) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(payload.latestBid.bidderName)}</td>
      <td>${formatCurrency(payload.latestBid.amount)}</td>
      <td>${new Date(payload.latestBid.createdAt).toLocaleString()}</td>
    `;
    bidTableBodyEl.prepend(row);
    while (bidTableBodyEl.children.length > 20) {
      bidTableBodyEl.removeChild(bidTableBodyEl.lastElementChild);
    }
    if (bidEmptyEl) {
      bidEmptyEl.style.display = "none";
    }
  }

  if (payload.status !== "open") {
    const formEl = root.querySelector("[data-bid-form]");
    if (formEl) {
      const closedNote = document.createElement("p");
      closedNote.textContent = "This auction has closed.";
      formEl.replaceWith(closedNote);
    }
  }

  const liveNoteEl = root.querySelector("[data-live-note]");
  if (liveNoteEl) {
    liveNoteEl.textContent = "Live update: auction state changed just now.";
  }
}

function applyListingUpdate(payload) {
  const card = document.querySelector(`[data-asset-card="${payload.assetId}"]`);
  if (!card) {
    return;
  }

  const cardPriceEl = card.querySelector("[data-asset-price]");
  if (cardPriceEl) {
    cardPriceEl.textContent = formatCurrency(payload.currentPrice);
  }

  const bidCountEl = card.querySelector("[data-asset-bid-count]");
  if (bidCountEl) {
    bidCountEl.textContent = String(payload.bidCount);
  }

  const badgeEl = card.querySelector("[data-asset-status-badge]");
  if (badgeEl) {
    setStatusBadge(badgeEl, payload.status);
  }
}

function setStatusPill(element, status) {
  element.textContent = String(status || "").toUpperCase();
  element.classList.remove("pill-open", "pill-closed");
  if (status === "open") {
    element.classList.add("pill-open");
  } else {
    element.classList.add("pill-closed");
  }
}

function setStatusBadge(element, status) {
  element.textContent = String(status || "").toUpperCase();
  element.classList.remove("badge-open", "badge-closed");
  if (status === "open") {
    element.classList.add("badge-open");
  } else {
    element.classList.add("badge-closed");
  }
}

function formatCurrency(value) {
  return `R ${Number(value).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
