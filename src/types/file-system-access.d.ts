// WICG File System Access API surface that lib.dom does not ship yet:
// the directory picker and the handle permission methods (Chromium-only).
interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'home' | 'music' | 'pictures' | 'videos';
}

interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
