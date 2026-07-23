// Model management UI helpers.

import * as api from "../api.js";

/**
 * List installed models.
 */
export async function listModels() {
  try {
    return await api.listModels();
  } catch (err) {
    console.error("[Models] Failed to list:", err);
    return [];
  }
}

/**
 * Inspect a .lsmodel package file.
 */
export async function inspectPackage(filePath) {
  return api.inspectModelPackage(filePath);
}

/**
 * Install a model from a .lsmodel package.
 */
export async function installModel(filePath) {
  return api.importModelPackage(filePath);
}

/**
 * Remove an installed model.
 */
export async function removeModel(modelId) {
  return api.removeModel(modelId);
}

/**
 * Refresh the model registry.
 */
export async function refreshModels() {
  return api.refreshModels();
}
