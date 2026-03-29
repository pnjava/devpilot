import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface Props {
  sessionId: string;
  onClose: () => void;
}

export default function EmailPreview({ sessionId, onClose }: Props) {
  const [recipients, setRecipients] = useState("");

  const { data: previewData } = useQuery({
    queryKey: ["email-preview", sessionId],
    queryFn: () => api.previewEmail(sessionId),
  });

  const sendMutation = useMutation({
    mutationFn: () => {
      const emails = recipients.split(",").map((e) => e.trim()).filter(Boolean);
      return api.sendEmail(sessionId, emails);
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold">📧 Email Summary Preview</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {previewData?.html ? (
            <div
              className="bg-white rounded-lg p-4 border"
              dangerouslySetInnerHTML={{ __html: previewData.html }}
            />
          ) : (
            <div className="text-gray-500 text-center py-8">Loading preview...</div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Recipients (comma-separated)</label>
            <input
              type="text"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="dev@team.com, pm@team.com"
              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => sendMutation.mutate()}
              disabled={!recipients || sendMutation.isPending}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-md"
            >
              {sendMutation.isPending ? "Sending..." : "📤 Send Email"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium rounded-md"
            >
              Cancel
            </button>
          </div>

          {sendMutation.isSuccess && (
            <p className="text-green-600 text-sm">
              ✅ {sendMutation.data?.message}
            </p>
          )}
          {sendMutation.isError && (
            <p className="text-red-500 text-sm">
              Error: {(sendMutation.error as Error).message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
