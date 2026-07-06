export interface VaultFs {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  list(dirPath: string): Promise<string[]>
  move(fromPath: string, toPath: string): Promise<void>
}

const ROOT_FOLDER = 'me.md'

export function assertVaultPath(path: string): void {
  if (path !== ROOT_FOLDER && !path.startsWith(`${ROOT_FOLDER}/`)) {
    throw new Error(`Vault path must stay inside ${ROOT_FOLDER}/: ${path}`)
  }
  if (path.split('/').some(segment => segment === '..')) {
    throw new Error(`Vault path cannot contain parent traversal: ${path}`)
  }
}

export function createFsaVaultFs(handle: FileSystemDirectoryHandle): VaultFs {
  return {
    async read(path: string): Promise<string | null> {
      assertVaultPath(path)
      const { directory, name } = await resolveParent(handle, path, false)
      if (!name || !directory) return null

      try {
        const fileHandle = await directory.getFileHandle(name, { create: false })
        return await (await fileHandle.getFile()).text()
      } catch (error) {
        if (isNamedDomError(error, 'NotFoundError')) return null
        throw error
      }
    },

    async write(path: string, content: string): Promise<void> {
      assertVaultPath(path)
      const { directory, name } = await resolveParent(handle, path, true)
      if (!directory || !name) throw new Error(`Invalid vault file path: ${path}`)

      const fileHandle = await directory.getFileHandle(name, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(content)
      await writable.close()
    },

    async list(dirPath: string): Promise<string[]> {
      assertVaultPath(dirPath)
      const directory = await resolveDirectory(handle, dirPath, false)
      if (!directory) return []

      const names: string[] = []
      for await (const [name] of directory.entries()) {
        names.push(name)
      }
      return names
    },

    async move(fromPath: string, toPath: string): Promise<void> {
      assertVaultPath(fromPath)
      assertVaultPath(toPath)

      const content = await this.read(fromPath)
      if (content === null) return
      await this.write(toPath, content)

      const { directory, name } = await resolveParent(handle, fromPath, false)
      if (!directory || !name) return
      await directory.removeEntry(name)
    },
  }
}

async function resolveDirectory(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  const segments = path.split('/').filter(Boolean)
  let directory = root

  for (const segment of segments) {
    try {
      directory = await directory.getDirectoryHandle(segment, { create })
    } catch (error) {
      if (!create && isNamedDomError(error, 'NotFoundError')) return null
      throw error
    }
  }

  return directory
}

async function resolveParent(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<{ directory: FileSystemDirectoryHandle | null; name: string | null }> {
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop() ?? null
  if (!name) return { directory: null, name: null }

  let directory = root
  for (const segment of segments) {
    try {
      directory = await directory.getDirectoryHandle(segment, { create })
    } catch (error) {
      if (!create && isNamedDomError(error, 'NotFoundError')) return { directory: null, name }
      throw error
    }
  }

  return { directory, name }
}

function isNamedDomError(error: unknown, name: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name: unknown }).name === name
}
