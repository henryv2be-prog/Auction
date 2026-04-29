(function setupRealtimeAuctionUpdates() {
  if (typeof io === "undefined") {
    return;
  }

  var roots = document.querySelectorAll("[data-realtime-root]");
  if (!roots.length) {
    return;
  }

  var modes = new Set();
  roots.forEach(function (root) {
    if (root.dataset.mode) {
      modes.add(root.dataset.mode);
    }
  });

  var detailRoot = null;
  var detailAssetId = null;
  roots.forEach(function (root) {
    if (root.dataset.mode === "detail") {
      detailRoot = root;
      detailAssetId = Number(root.dataset.assetId);
    }
  });

  var auctionDetailRoot = null;
  var auctionDetailId = null;
  roots.forEach(function (root) {
    if (root.dataset.mode === "auction-detail") {
      auctionDetailRoot = root;
      auctionDetailId = Number(root.dataset.auctionId);
    }
  });

  var socket = io();

  if (modes.has("detail") && Number.isInteger(detailAssetId) && detailAssetId > 0) {
    socket.emit("asset:subscribe", detailAssetId);
    window.addEventListener("beforeunload", function () {
      socket.emit("asset:unsubscribe", detailAssetId);
    });

    socket.on("asset:update", function (payload) {
      if (!payload || payload.assetId !== detailAssetId) {
        return;
      }
      applyDetailUpdate(detailRoot, payload);
    });
  }

  socket.on("asset:listing-update", function (payload) {
    if (!payload || !payload.assetId) {
      return;
    }
    applyListingUpdate(payload);
  });

  socket.on("auction:update", function (payload) {
    if (!payload || !payload.auctionId) {
      return;
    }
    applyAuctionUpdate(payload, {
      currentAuctionDetailId: auctionDetailId
    });
  });
})();

function applyDetailUpdate(root, payload) {
  var currentPriceEl = root.querySelector("[data-current-price]");
  if (currentPriceEl) {
    currentPriceEl.textContent = formatCurrency(payload.currentPrice);
  }

  var minimumBidHintEl = root.querySelector("[data-minimum-bid]");
  if (minimumBidHintEl) {
    minimumBidHintEl.textContent = formatCurrency(payload.currentPrice);
  }

  var statusPillEl = root.querySelector("[data-asset-status-pill]");
  if (statusPillEl) {
    setStatusPill(statusPillEl, payload.status);
  }

  var bidTableBodyEl = root.querySelector("[data-bids-body]");
  var bidEmptyEl = root.querySelector("[data-bids-empty]");
  if (payload.latestBid && bidTableBodyEl) {
    var row = document.createElement("tr");
    row.innerHTML =
      '<td data-label="Bidder">' + escapeHtml(payload.latestBid.bidderName) + "</td>" +
      '<td data-label="Amount">' + formatCurrency(payload.latestBid.amount) + "</td>" +
      '<td data-label="Time">' + formatSastDateTime(payload.latestBid.createdAt) + "</td>";
    bidTableBodyEl.prepend(row);
    while (bidTableBodyEl.children.length > 20) {
      bidTableBodyEl.removeChild(bidTableBodyEl.lastElementChild);
    }
    if (bidEmptyEl) {
      bidEmptyEl.style.display = "none";
    }
  }

  if (payload.status !== "open") {
    var formEl = root.querySelector("[data-bid-form]");
    if (formEl) {
      var closedNote = document.createElement("p");
      closedNote.textContent = "This auction has closed.";
      formEl.replaceWith(closedNote);
    }
  }

  var liveNoteEl = root.querySelector("[data-live-note]");
  if (liveNoteEl) {
    liveNoteEl.textContent = "Live update: auction state changed just now.";
  }
}

function applyListingUpdate(payload) {
  var card = document.querySelector('[data-asset-card="' + payload.assetId + '"]');
  if (!card) {
    return;
  }

  var cardPriceEl = card.querySelector("[data-asset-price]");
  if (cardPriceEl) {
    cardPriceEl.textContent = formatCurrency(payload.currentPrice);
  }

  var bidCountEl = card.querySelector("[data-asset-bid-count]");
  if (bidCountEl) {
    bidCountEl.textContent = String(payload.bidCount);
  }

  var badgeEl = card.querySelector("[data-asset-status-badge]");
  if (badgeEl) {
    setStatusBadge(badgeEl, payload.status);
  }
}

function syncAuctionCardFeatureImage(card, payload) {
  if (!card || !payload || typeof payload.auctionId === "undefined") {
    return;
  }
  var url = payload.featureImageUrl || "";
  var existing = card.querySelector("[data-auction-feature-img]");
  var body = card.querySelector(".auction-card-body");

  if (url) {
    if (existing) {
      existing.src = url;
    } else if (body) {
      var wrap = document.createElement("a");
      wrap.className = "auction-card-media";
      wrap.href = "/auctions/" + payload.auctionId;
      wrap.setAttribute("aria-hidden", "true");
      wrap.setAttribute("tabindex", "-1");
      var img = document.createElement("img");
      img.className = "auction-card-cover";
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.setAttribute("data-auction-feature-img", "");
      wrap.appendChild(img);
      card.insertBefore(wrap, body);
      card.classList.remove("auction-card-no-image");
    }
  } else if (existing) {
    var mediaWrap = existing.closest(".auction-card-media");
    if (mediaWrap && mediaWrap.parentNode) {
      mediaWrap.parentNode.removeChild(mediaWrap);
    }
    card.classList.add("auction-card-no-image");
  }
}

function syncAuctionToolbarCover(toolbar, payload) {
  if (!toolbar || !payload) {
    return;
  }
  var inner = toolbar.querySelector(".public-toolbar-compact-inner");
  var existing = toolbar.querySelector("[data-auction-detail-cover]");
  var url = payload.featureImageUrl || "";
  if (url) {
    if (existing) {
      var img = existing.querySelector("[data-auction-feature-img]");
      if (img) {
        img.src = url;
      }
    } else if (inner) {
      var wrap = document.createElement("div");
      wrap.className = "public-toolbar-cover";
      wrap.setAttribute("data-auction-detail-cover", "");
      wrap.setAttribute("aria-hidden", "true");
      var newImg = document.createElement("img");
      newImg.src = url;
      newImg.alt = "";
      newImg.loading = "lazy";
      newImg.setAttribute("data-auction-feature-img", "");
      wrap.appendChild(newImg);
      toolbar.insertBefore(wrap, inner);
    }
  } else if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
}

function applyAuctionUpdate(payload, context) {
  var card = document.querySelector('[data-auction-card="' + payload.auctionId + '"]');
  var detailRoot = document.querySelector('[data-mode="auction-detail"][data-auction-id="' + payload.auctionId + '"]');
  var toolbar = document.querySelector('[data-auction-toolbar-for="' + payload.auctionId + '"]');

  var elementsToPatch = [];
  if (card) elementsToPatch.push(card);
  if (detailRoot) elementsToPatch.push(detailRoot);
  if (toolbar) elementsToPatch.push(toolbar);

  if (!elementsToPatch.length) {
    return;
  }

  elementsToPatch.forEach(function (scope) {
    var nameEl = scope.querySelector("[data-auction-name]");
    if (nameEl && payload.name) {
      nameEl.textContent = payload.name;
    }

    var descriptionEl = scope.querySelector("[data-auction-description]");
    if (descriptionEl && typeof payload.description === "string") {
      descriptionEl.textContent = payload.description || "No description provided.";
    }

    var startEl = scope.querySelector("[data-auction-start]");
    if (startEl && payload.startAt) {
      startEl.textContent = formatSastDateTime(payload.startAt);
      startEl.setAttribute("data-iso", payload.startAt);
    }

    var endEl = scope.querySelector("[data-auction-end]");
    if (endEl && payload.endAt) {
      endEl.textContent = formatSastDateTime(payload.endAt);
      endEl.setAttribute("data-iso", payload.endAt);
    }

    var assetCountEl = scope.querySelector("[data-auction-asset-count]");
    if (assetCountEl && typeof payload.assetCount === "number") {
      assetCountEl.textContent = String(payload.assetCount);
    }

    if (scope.getAttribute && scope.getAttribute("data-auction-toolbar-for")) {
      syncAuctionToolbarCover(scope, payload);
    } else if (scope.classList && scope.classList.contains("auction-card")) {
      syncAuctionCardFeatureImage(scope, payload);
    } else {
      var featureImg = scope.querySelector("[data-auction-feature-img]");
      if (featureImg && payload.featureImageUrl) {
        featureImg.src = payload.featureImageUrl;
      }
    }

    var phaseBadgeEl = scope.querySelector("[data-auction-phase-badge]");
    if (phaseBadgeEl && payload.phase) {
      setPhaseBadge(phaseBadgeEl, payload.phase);
    }

    if (payload.phase) {
      scope.setAttribute("data-auction-phase", payload.phase);
    }
  });

  if (card && card.getAttribute("data-auction-phase") !== payload.phase) {
    moveCardToCorrectGroup(card, payload);
  }

  if (
    context &&
    context.currentAuctionDetailId &&
    context.currentAuctionDetailId === payload.auctionId &&
    payload.phase === "closed"
  ) {
    showLiveBanner(detailRoot, "This auction has just closed. Reloading…");
    setTimeout(function () {
      window.location.reload();
    }, 1500);
  }

  if (
    context &&
    context.currentAuctionDetailId &&
    context.currentAuctionDetailId === payload.auctionId &&
    payload.phase === "live" &&
    detailRoot &&
    detailRoot.getAttribute("data-was-live") !== "true"
  ) {
    detailRoot.setAttribute("data-was-live", "true");
    showLiveBanner(detailRoot, "This auction is now live. Bidding is open.");
  }
}

function moveCardToCorrectGroup(card, payload) {
  var targetGroupKey = payload.phase === "live" ? "live" : payload.phase === "upcoming" ? "upcoming" : "past";
  var targetGroup = document.querySelector('[data-auction-group="' + targetGroupKey + '"]');
  if (!targetGroup) {
    return;
  }
  var targetGrid = targetGroup.querySelector("[data-auction-group-grid]");
  var emptyEl = targetGroup.querySelector("[data-auction-group-empty]");
  if (!targetGrid) {
    targetGrid = document.createElement("div");
    targetGrid.className = "grid";
    targetGrid.setAttribute("data-auction-group-grid", "");
    if (emptyEl) {
      emptyEl.replaceWith(targetGrid);
    } else {
      targetGroup.appendChild(targetGrid);
    }
  } else if (emptyEl) {
    emptyEl.remove();
  }

  var sourceGroup = card.closest("[data-auction-group]");
  card.parentNode.removeChild(card);
  card.classList.add("auction-card-flash");
  setTimeout(function () {
    card.classList.remove("auction-card-flash");
  }, 1500);
  targetGrid.prepend(card);

  refreshGroupCount(sourceGroup);
  refreshGroupCount(targetGroup);
}

function refreshGroupCount(group) {
  if (!group) return;
  var grid = group.querySelector("[data-auction-group-grid]");
  var count = grid ? grid.querySelectorAll("[data-auction-card]").length : 0;
  var countEl = group.querySelector("[data-auction-group-count]");
  if (countEl) {
    countEl.textContent = String(count);
  }
  if (count === 0 && grid && !group.querySelector("[data-auction-group-empty]")) {
    var empty = document.createElement("p");
    empty.className = "muted";
    empty.setAttribute("data-auction-group-empty", "");
    var groupKey = group.getAttribute("data-auction-group");
    if (groupKey === "live") empty.textContent = "No auctions are currently live. Check back soon.";
    else if (groupKey === "upcoming") empty.textContent = "No upcoming auctions scheduled.";
    else empty.textContent = "No past auctions yet.";
    grid.replaceWith(empty);
  }
}

function showLiveBanner(scope, message) {
  if (!scope) return;
  var banner = scope.querySelector("[data-live-banner]");
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "alert alert-success live-banner";
    banner.setAttribute("data-live-banner", "");
    scope.prepend(banner);
  }
  banner.textContent = message;
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

function setPhaseBadge(element, phase) {
  element.classList.remove("badge-live", "badge-upcoming", "badge-closed", "badge-open");
  if (phase === "live") {
    element.classList.add("badge-live");
    element.textContent = "Live";
  } else if (phase === "upcoming") {
    element.classList.add("badge-upcoming");
    element.textContent = "Upcoming";
  } else {
    element.classList.add("badge-closed");
    element.textContent = "Closed";
  }
}

function formatCurrency(value) {
  return "R " + Number(value).toFixed(2);
}

var sastFormatter = (function () {
  try {
    return new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch (e) {
    return null;
  }
})();

function formatSastDateTime(value) {
  if (!value) return "";
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "";
  if (sastFormatter) {
    return sastFormatter.format(date);
  }
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
