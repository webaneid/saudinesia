-- Penghapusan akun UU PDP (DEL-02): pemilik akun boleh menarik permintaan yang masih pending.
ALTER TYPE "DeletionRequestStatus" ADD VALUE 'withdrawn';
