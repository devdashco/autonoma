import type { Screenshot } from "@autonoma/image";
import type { GenerateTextResult, ModelMessage, ToolSet } from "ai";
import type { UploadedVideo } from "./video/video-processor";

type NonEmptyArray<T> = [T, ...T[]];

type RequiredObjectGenerationParams =
    | {
          userPrompt: string;
          images?: NonEmptyArray<Screenshot>;
          /** Raw messages to be used as user messages. These will be prepended to the user prompt and images. */
          rawMessages?: NonEmptyArray<ModelMessage>;
      }
    | {
          userPrompt?: never;
          images: NonEmptyArray<Screenshot>;
          /** Raw messages to be used as user messages. These will be prepended to the user prompt and images. */
          rawMessages?: NonEmptyArray<ModelMessage>;
      }
    | {
          userPrompt?: never;
          images?: never;
          /** Raw messages to be used as user messages. These will be prepended to the user prompt and images. */
          rawMessages: NonEmptyArray<ModelMessage>;
      };

export type ObjectGenerationParams = RequiredObjectGenerationParams & { video?: UploadedVideo };

export function buildMessages({ userPrompt, images, rawMessages, video }: ObjectGenerationParams): ModelMessage[] {
    return [
        ...(rawMessages ?? []),
        ...(userPrompt != null
            ? [{ role: "user" as const, content: [{ type: "text" as const, text: userPrompt }] }]
            : []),
        ...(images != null
            ? images.map((image) => ({
                  role: "user" as const,
                  content: [{ type: "image" as const, image: image.base64 }],
              }))
            : []),
        ...(video != null
            ? [
                  {
                      role: "user" as const,
                      // Reference: https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai#file-inputs
                      content: [{ type: "file" as const, data: video.uri, mediaType: video.mimeType }],
                  },
              ]
            : []),
    ];
}

export function extractMessages<TOOLS extends ToolSet>(generateResult: GenerateTextResult<TOOLS, any>): ModelMessage[] {
    return generateResult.response.messages;
}
