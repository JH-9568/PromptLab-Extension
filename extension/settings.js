globalThis.PromptLabSettings = Object.freeze({
  storageKey: 'promptlab_rewrite_settings',
  maxInstructionsLength: 600,
  normalize(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      mode: ['light', 'balanced', 'detailed'].includes(source.mode) ? source.mode : 'balanced',
      instructions: typeof source.instructions === 'string' ? source.instructions.slice(0, 600).trim() : '',
      instructionsEnabled: source.instructionsEnabled === true
    };
  }
});
