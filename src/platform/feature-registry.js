export class FeatureRegistry {
  constructor() {
    this.registrations = new Map();
  }

  register(feature, handler, options = {}) {
    if (typeof handler?.execute !== "function") {
      throw new TypeError(`Handler for ${feature} must implement execute()`);
    }
    const entries = this.registrations.get(feature) || [];
    entries.push({
      handler,
      matches: options.matches || (() => true),
      priority: Number(options.priority || 0),
    });
    entries.sort((left, right) => right.priority - left.priority);
    this.registrations.set(feature, entries);
    return this;
  }

  resolve(feature, platformContext) {
    const entry = (this.registrations.get(feature) || []).find(({ matches }) =>
      matches(platformContext),
    );
    if (!entry) {
      const error = new Error(
        `PLATFORM_FEATURE_UNRESOLVED: ${feature} (${platformContext.os}/${platformContext.host})`,
      );
      error.code = "PLATFORM_FEATURE_UNRESOLVED";
      throw error;
    }
    return entry.handler;
  }
}

export const featureRegistry = new FeatureRegistry();
