(function setupUploadProgress() {
  var forms = document.querySelectorAll("[data-upload-form]");
  if (!forms.length) {
    return;
  }

  forms.forEach(function (form) {
    var fileInputs = form.querySelectorAll('input[type="file"]');
    if (!fileInputs.length) {
      return;
    }

    var ui = createProgressUi(form);
    var submitButton = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", function (event) {
      var hasAnyFile = false;
      fileInputs.forEach(function (input) {
        if (input.files && input.files.length) {
          hasAnyFile = true;
        }
      });

      if (!hasAnyFile) {
        return;
      }

      event.preventDefault();
      uploadWithProgress(form, ui, submitButton);
    });
  });

  function createProgressUi(form) {
    var existing = form.querySelector("[data-upload-ui]");
    if (existing) {
      return wireUi(existing);
    }

    var wrap = document.createElement("div");
    wrap.className = "upload-ui";
    wrap.setAttribute("data-upload-ui", "");
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="upload-status" data-upload-status></div>' +
      '<div class="upload-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '<div class="upload-bar-fill" data-upload-bar-fill style="width:0%"></div>' +
      "</div>" +
      '<p class="upload-message" data-upload-message></p>';

    var buttonRow = form.querySelector(".button-row");
    if (buttonRow) {
      buttonRow.insertAdjacentElement("beforebegin", wrap);
    } else {
      form.appendChild(wrap);
    }

    return wireUi(wrap);
  }

  function wireUi(wrap) {
    return {
      root: wrap,
      bar: wrap.querySelector("[data-upload-bar-fill]"),
      barRoot: wrap.querySelector(".upload-bar"),
      status: wrap.querySelector("[data-upload-status]"),
      message: wrap.querySelector("[data-upload-message]")
    };
  }

  function setProgress(ui, percent, statusText) {
    ui.root.hidden = false;
    ui.root.classList.remove("upload-ui-error");
    var rounded = Math.max(0, Math.min(100, Math.round(percent)));
    ui.bar.style.width = rounded + "%";
    ui.barRoot.setAttribute("aria-valuenow", String(rounded));
    if (statusText) {
      ui.status.textContent = statusText + " — " + rounded + "%";
    }
  }

  function setIndeterminate(ui, statusText) {
    ui.root.hidden = false;
    ui.root.classList.remove("upload-ui-error");
    ui.barRoot.classList.add("upload-bar-indeterminate");
    ui.bar.style.width = "100%";
    if (statusText) {
      ui.status.textContent = statusText;
    }
  }

  function clearIndeterminate(ui) {
    ui.barRoot.classList.remove("upload-bar-indeterminate");
  }

  function setMessage(ui, text, isError) {
    ui.message.textContent = text || "";
    ui.root.classList.toggle("upload-ui-error", Boolean(isError));
  }

  function uploadWithProgress(form, ui, submitButton) {
    var url = form.getAttribute("action") || window.location.href;
    var method = (form.getAttribute("method") || "POST").toUpperCase();
    var formData = new FormData(form);

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.originalLabel = submitButton.textContent;
      submitButton.textContent = "Uploading…";
    }

    setProgress(ui, 0, "Preparing upload");
    setMessage(ui, "");

    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.timeout = 10 * 60 * 1000;

    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) {
        var percent = (event.loaded / event.total) * 100;
        setProgress(ui, percent, "Uploading");
      } else {
        setIndeterminate(ui, "Uploading…");
      }
    };

    xhr.upload.onload = function () {
      clearIndeterminate(ui);
      setProgress(ui, 100, "Processing on server");
      setIndeterminate(ui, "Processing on server…");
    };

    xhr.onerror = function () {
      clearIndeterminate(ui);
      finishWithError(ui, submitButton, "Network error while uploading. Please check your connection and try again.");
    };

    xhr.ontimeout = function () {
      clearIndeterminate(ui);
      finishWithError(ui, submitButton, "Upload timed out. Try with smaller files or a faster connection.");
    };

    xhr.onabort = function () {
      clearIndeterminate(ui);
      finishWithError(ui, submitButton, "Upload was cancelled.");
    };

    xhr.onload = function () {
      clearIndeterminate(ui);
      handleResponse(xhr, ui, submitButton);
    };

    try {
      xhr.send(formData);
    } catch (error) {
      clearIndeterminate(ui);
      finishWithError(ui, submitButton, "Could not start the upload: " + (error && error.message ? error.message : "unknown error"));
    }
  }

  function handleResponse(xhr, ui, submitButton) {
    var status = xhr.status;
    var contentType = xhr.getResponseHeader("Content-Type") || "";

    if (status === 0) {
      finishWithError(ui, submitButton, "Upload failed before completing. Please try again.");
      return;
    }

    if (status >= 200 && status < 300 && contentType.indexOf("application/json") !== -1) {
      var ok;
      try {
        ok = JSON.parse(xhr.responseText);
      } catch (parseError) {
        ok = null;
      }
      setProgress(ui, 100, "Done");
      setMessage(ui, (ok && ok.message) || "Upload complete.", false);
      var redirectTo = (ok && ok.redirect) || window.location.pathname;
      window.location.assign(redirectTo);
      return;
    }

    if (status >= 200 && status < 400) {
      setProgress(ui, 100, "Done");
      setMessage(ui, "Upload complete.", false);
      var headerLocation = xhr.getResponseHeader("Location");
      window.location.assign(headerLocation || window.location.pathname);
      return;
    }

    var message = "Upload failed with status " + status + ".";
    if (contentType.indexOf("application/json") !== -1) {
      try {
        var body = JSON.parse(xhr.responseText);
        if (body && body.error) {
          message = body.error;
        }
      } catch (e) {
        // ignore parse error
      }
    } else if (status === 413) {
      message = "Files are too large. Please reduce the size or upload fewer files.";
    } else if (status === 401 || status === 403) {
      message = "You are not allowed to perform this upload. Try logging in again.";
    } else if (status >= 500) {
      message = "The server hit an error while processing the upload. Please try again.";
    }

    finishWithError(ui, submitButton, message);
  }

  function finishWithError(ui, submitButton, message) {
    ui.bar.style.width = "0%";
    ui.barRoot.setAttribute("aria-valuenow", "0");
    ui.status.textContent = "Upload failed";
    setMessage(ui, message, true);
    if (submitButton) {
      submitButton.disabled = false;
      if (submitButton.dataset.originalLabel) {
        submitButton.textContent = submitButton.dataset.originalLabel;
      }
    }
  }
})();
