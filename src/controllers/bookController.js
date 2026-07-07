const prisma = require('../config/database');

// ============================================================
// GET all books (with optional filters)
// ============================================================
const getBooks = async (req, res) => {
  try {
    const { search, category, school } = req.query;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    let whereClause = {};

    // Filter by school
    if (!isSuperAdmin && userSchool) {
      whereClause.school = userSchool;
    } else if (school) {
      whereClause.school = school;
    }

    // Search by title, author, or ISBN
    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { author: { contains: search, mode: 'insensitive' } },
        { isbn: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Filter by category
    if (category) {
      whereClause.category = category;
    }

    const books = await prisma.book.findMany({
      where: whereClause,
      include: {
        transactions: {
          where: { returnedAt: null },
          include: { student: { include: { user: true } } }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Get unique categories for filter dropdown
    const categories = await prisma.book.groupBy({
      by: ['category'],
      where: { category: { not: null } }
    });

    res.render('admin/books', {
      title: 'Book Management',
      books: books,
      categories: categories.map(c => c.category).filter(Boolean),
      userSchool,
      isSuperAdmin,
      adminInfo: req.user?.admin || null,
      user: req.session.user,
      filters: { search, category, school }
    });
  } catch (error) {
    console.error('Get books error:', error);
    res.status(500).render('error/500', { title: 'Server Error', adminInfo: req.user?.admin || null });
  }
};

// ============================================================
// GET book by ID
// ============================================================
const getBook = async (req, res) => {
  try {
    const { bookId } = req.params;
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        transactions: {
          include: {
            student: { include: { user: true } },
            recorder: { select: { firstName: true, lastName: true } }
          },
          orderBy: { recordedAt: 'desc' },
          take: 20
        }
      }
    });

    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    // Check if book is currently borrowed
    const currentBorrow = book.transactions.find(t => t.action === 'borrow' && !t.returnedAt);

    res.json({
      success: true,
      book: {
        ...book,
        isBorrowed: !!currentBorrow,
        currentBorrower: currentBorrow ? {
          name: `${currentBorrow.student.user.firstName} ${currentBorrow.student.user.lastName}`,
          dueDate: currentBorrow.dueDate
        } : null
      }
    });
  } catch (error) {
    console.error('Get book error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// CREATE book
// ============================================================
const createBook = async (req, res) => {
  try {
    const { title, author, isbn, copies, location, category } = req.body;
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    if (!title) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const school = isSuperAdmin ? req.body.school || null : userSchool;

    const book = await prisma.book.create({
      data: {
        title: title.trim(),
        author: author?.trim() || null,
        isbn: isbn?.trim() || null,
        copies: parseInt(copies) || 1,
        available: parseInt(copies) || 1,
        location: location?.trim() || null,
        category: category?.trim() || null,
        school: school
      }
    });

    res.json({ success: true, message: 'Book created successfully', book });
  } catch (error) {
    console.error('Create book error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// UPDATE book
// ============================================================
const updateBook = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { title, author, isbn, copies, location, category } = req.body;

    const existingBook = await prisma.book.findUnique({
      where: { id: bookId }
    });

    if (!existingBook) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    const updatedBook = await prisma.book.update({
      where: { id: bookId },
      data: {
        title: title?.trim() || existingBook.title,
        author: author?.trim() || null,
        isbn: isbn?.trim() || null,
        copies: parseInt(copies) || existingBook.copies,
        location: location?.trim() || null,
        category: category?.trim() || null
      }
    });

    res.json({ success: true, message: 'Book updated successfully', book: updatedBook });
  } catch (error) {
    console.error('Update book error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// DELETE book
// ============================================================
const deleteBook = async (req, res) => {
  try {
    const { bookId } = req.params;

    const existingBook = await prisma.book.findUnique({
      where: { id: bookId },
      include: {
        transactions: {
          where: { returnedAt: null }
        }
      }
    });

    if (!existingBook) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    // Check if book is currently borrowed
    if (existingBook.transactions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete book that is currently borrowed'
      });
    }

    // Delete all transactions first
    await prisma.libraryTransaction.deleteMany({
      where: { bookId: bookId }
    });

    // Delete the book
    await prisma.book.delete({
      where: { id: bookId }
    });

    res.json({ success: true, message: 'Book deleted successfully' });
  } catch (error) {
    console.error('Delete book error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// GET book borrowing history for a student
// ============================================================
const getStudentBookHistory = async (req, res) => {
  try {
    const { studentId } = req.params;
    const transactions = await prisma.libraryTransaction.findMany({
      where: { studentId: studentId },
      include: {
        book: true,
        recorder: { select: { firstName: true, lastName: true } }
      },
      orderBy: { recordedAt: 'desc' },
      take: 50
    });

    res.json({ success: true, transactions });
  } catch (error) {
    console.error('Get student book history error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================================
// GET all available books (for scanner dropdown)
// ============================================================
const getAvailableBooks = async (req, res) => {
  try {
    const userSchool = req.userSchool;
    const isSuperAdmin = req.isSuperAdmin;

    let whereClause = { available: { gt: 0 } };
    if (!isSuperAdmin && userSchool) {
      whereClause.school = userSchool;
    }

    const books = await prisma.book.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        author: true,
        available: true,
        category: true
      },
      orderBy: { title: 'asc' }
    });

    res.json({ success: true, books });
  } catch (error) {
    console.error('Get available books error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  getBooks,
  getBook,
  createBook,
  updateBook,
  deleteBook,
  getStudentBookHistory,
  getAvailableBooks
};