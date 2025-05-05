import { useContext, useRef, useState } from "react";
import { Button, Input, Card, Tooltip, Progress } from "@nextui-org/react";
import {
  blossomUploadImages,
  getLocalStorageData,
} from "@/utils/nostr/nostr-helper-functions";
import FailureModal from "./failure-modal";
import { SignerContext } from "@/components/utility-components/nostr-context-provider";
import { AnimatePresence, motion } from "framer-motion";
import { XCircleIcon, PhotoIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";

// Maximum file size in bytes (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const FileUploaderButton = ({
  disabled,
  isIconOnly = false,
  className = "",
  children,
  imgCallbackOnUpload,
}: {
  disabled?: boolean;
  isIconOnly?: boolean;
  className?: string;
  children: React.ReactNode;
  imgCallbackOnUpload: (imgUrl: string) => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [showFailureModal, setShowFailureModal] = useState(false);
  const [failureText, setFailureText] = useState("");
  const [previews, setPreviews] = useState<{ src: string; name: string; size: number }[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const hiddenFileInput = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const { signer, isLoggedIn } = useContext(SignerContext);
  const { blossomServers } = getLocalStorageData() || {};

  // Create base64 preview for UI
  const getBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    else return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  // Strip metadata from image
  const stripImageMetadata = async (imageFile: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      const url = URL.createObjectURL(imageFile);

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Failed to get canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to create blob"));
            return;
          }
          const strippedFile = new File([blob], imageFile.name, {
            type: imageFile.type,
            lastModified: Date.now(),
          });
          URL.revokeObjectURL(url);
          resolve(strippedFile);
        }, imageFile.type);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image"));
      };

      img.src = url;
    });
  };

  // Main upload logic
  const uploadImages = async (files: FileList) => {
    try {
      const imageFiles = Array.from(files);

      // Strict MIME type check
      if (
        imageFiles.some(
          (imgFile) =>
            !imgFile.type.startsWith("image/") ||
            !ALLOWED_TYPES.includes(imgFile.type)
        )
      ) {
        throw new Error(
          "Only JPEG, PNG, or WebP images are supported!"
        );
      }

      // File size check
      if (imageFiles.some((imgFile) => imgFile.size > MAX_FILE_SIZE)) {
        throw new Error(
          `Each image must be smaller than ${MAX_FILE_SIZE / (1024 * 1024)} MB`
        );
      }

      setProgress(0);

      // Show base64 previews
      const previewsList = await Promise.all(
        imageFiles.map(async (file) => {
          const base64 = await getBase64(file);
          return { src: base64, name: file.name, size: file.size };
        })
      );
      setPreviews(previewsList);

      // Stage 1: Stripping metadata (30%)
      const strippedImageFiles = await Promise.all(
        imageFiles.map(async (imageFile, idx) => {
          const stripped = await stripImageMetadata(imageFile);
          setProgress(Math.round(((idx + 1) / imageFiles.length) * 30));
          return stripped;
        })
      );

      // Stage 2: Uploading to servers (30% to 100%)
      let responses: any[] = [];
      if (isLoggedIn) {
        responses = await Promise.all(
          strippedImageFiles.map(async (imageFile, idx) => {
            const tags = await blossomUploadImages(
              imageFile,
              signer!,
              blossomServers && blossomServers.length > 0
                ? blossomServers
                : ["https://cdn.nostrcheck.me"]
            );
            setProgress(30 + Math.round(((idx + 1) / strippedImageFiles.length) * 70));
            return tags;
          })
        );
      }

      const imageUrls = responses
        .filter((response) => response && Array.isArray(response))
        .map((response: string[][]) => {
          const urlTag = response.find(
            (tag) => Array.isArray(tag) && tag[0] === "url"
          );
          if (urlTag && urlTag.length > 1) {
            return urlTag[1];
          }
          return null;
        })
        .filter((url) => url !== null);

      setTimeout(() => {
        setProgress(null); // Reset progress after a short delay for better UX
      }, 500);

      if (imageUrls && imageUrls.length > 0) {
        return imageUrls;
      } else {
        setFailureText(
          "Image upload failed to yield a URL! Change your Blossom media server in settings or try again."
        );
        setShowFailureModal(true);
        return [];
      }
    } catch (e) {
      setProgress(null);
      setFailureText(
        e instanceof Error
          ? e.message
          : "Failed to upload image! Change your Blossom media server in settings."
      );
      setShowFailureModal(true);
      return [];
    }
  };

  const handleClick = () => {
    if (disabled || loading) return;
    hiddenFileInput.current?.click();
  };

  const handleChange = async (e: React.FormEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files;
    setLoading(true);
    if (files) {
      const uploadedImages = await uploadImages(files);
      uploadedImages
        .filter((imgUrl): imgUrl is string => imgUrl !== null)
        .forEach((imgUrl) => imgCallbackOnUpload(imgUrl));
    }
    setLoading(false);
    if (hiddenFileInput.current) {
      hiddenFileInput.current.value = "";
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setLoading(true);
      const uploadedImages = await uploadImages(files);
      uploadedImages
        .filter((imgUrl): imgUrl is string => imgUrl !== null)
        .forEach((imgUrl) => imgCallbackOnUpload(imgUrl));
      setLoading(false);
    }
  };

  // Remove preview and clear uploaded image from parent
  const removePreview = (index: number) => {
    setPreviews((prev) => prev.filter((_, idx) => idx !== index));
    imgCallbackOnUpload(""); // Notify parent of removal (adjust as needed)
  };

  // Clear all previews and uploaded images
  const clearAll = () => {
    setPreviews([]);
    imgCallbackOnUpload(""); // Notify parent to remove all uploaded images
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Drag and Drop Zone */}
      <div
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full relative transition-all duration-300 ${
          isDragging 
            ? "border-2 border-dashed border-primary-500 bg-primary-50/50 rounded-xl p-6" 
            : "border-2 border-dashed border-transparent"
        }`}
      >
        {/* Drag overlay */}
        {isDragging && (
          <motion.div 
            className="absolute inset-0 flex flex-col items-center justify-center bg-primary-50/95 rounded-xl z-10 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            >
              <PhotoIcon className="w-16 h-16 text-primary-500 mb-4" />
            </motion.div>
            <p className="text-primary-700 font-semibold text-xl">Drop to upload</p>
            <p className="text-primary-500 text-sm mt-1">Supports JPEG, PNG, WebP</p>
          </motion.div>
        )}
        
        {/* Full-width upload button */}
        <Button
          isLoading={loading}
          onClick={handleClick}
          isIconOnly={isIconOnly}
          disabled={disabled || loading}
          className={`w-full h-16 ${className} transition-all`}
          size="lg"
          color="primary"
          variant="flat"
          radius="lg"
          startContent={
            !isIconOnly && (
              <motion.div
                animate={loading ? {} : { scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <ArrowUpTrayIcon className="w-6 h-6 mr-2" />
              </motion.div>
            )
          }
        >
          {children || (isIconOnly ? null : (
            <span className="text-lg font-medium">Upload Images</span>
          ))}
        </Button>
        
        <Input
          type="file"
          accept={ALLOWED_TYPES.join(",")}
          multiple
          ref={hiddenFileInput}
          onInput={handleChange}
          className="hidden"
        />
      </div>

      {/* Progress Bar */}
      <AnimatePresence>
        {progress !== null && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="w-full space-y-4"
          >
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-default-700">
                Uploading {previews.length} image{previews.length > 1 ? 's' : ''}
              </span>
              <span className="text-sm font-medium text-purple-600 dark:text-yellow-400">
                {progress}%
              </span>
            </div>
            <Progress 
              aria-label="Upload progress"
              size="md"
              value={progress}
              color="primary"
              classNames={{
                track: "h-3",
                indicator: "bg-gradient-to-r from-pink-400 to-pink-600"
              }}
            />
            <div className="flex justify-between text-xs text-default-500">
              <span>Preprocessing{progress >= 30 ? ' ✓' : ''}</span>
              <span>Uploading{progress >= 100 ? ' ✓' : ''}</span>
              <span>Processing</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Previews */}
      <AnimatePresence>
        {previews.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="w-full mt-4"
          >
            <Card className="w-full p-4 bg-content1 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <PhotoIcon className="w-5 h-5 text-purple-500 dark:text-yellow-400" />
                  Selected Images
                  <span className="text-default-500 ml-1">({previews.length})</span>
                </h3>
                <Button
                  size="sm"
                  variant="light"
                  onClick={clearAll}
                  className="text-danger-500"
                >
                  Clear All
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {previews.map((preview, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    whileHover={{ scale: 1.02 }}
                    className="relative group"
                  >
                    <Card className="overflow-hidden shadow-md hover:shadow-lg transition-shadow">
                      <div className="relative pb-[100%]">
                        <img
                          src={preview.src}
                          alt={`preview-${idx}`}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Tooltip content="Remove image">
                            <Button
                              isIconOnly
                              size="sm"
                              color="danger"
                              className="bg-white/90 hover:bg-white"
                              onClick={() => removePreview(idx)}
                            >
                              <XCircleIcon className="w-5 h-5" />
                            </Button>
                          </Tooltip>
                        </div>
                      </div>
                      <div className="p-2 bg-content2">
                        <p className="text-xs font-medium truncate" title={preview.name}>
                          {preview.name}
                        </p>
                        <p className="text-xs text-default-500">
                          {formatFileSize(preview.size)}
                        </p>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      
      <FailureModal
        bodyText={failureText}
        isOpen={showFailureModal}
        onClose={() => {
          setShowFailureModal(false);
          setFailureText("");
        }}
      />
    </div>
  );
};
