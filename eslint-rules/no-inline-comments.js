export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow all comments in test files, except the // @include-parallel and // @include-serial directives",
      recommended: false,
    },
    schema: [],
    messages: {
      noComment: "Comments are not allowed in test files.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program() {
        const filename = context.filename ?? context.getFilename();
        if (!filename.includes(".test.")) return;

        for (const comment of sourceCode.getAllComments()) {
          // Integration project directive, read by vitest.integration.serial.ts.
          if (/^ @include-(parallel|serial)$/.test(comment.value)) continue;
          context.report({
            loc: comment.loc,
            messageId: "noComment",
          });
        }
      },
    };
  },
};
