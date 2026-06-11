import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Interner Serverfehler';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // P0001 = Append-only-Trigger (verbotene Mutation)
      if (exception.code === 'P2010' || (exception.meta?.code as string) === 'P0001') {
        status = HttpStatus.CONFLICT;
        message = 'Append-only-Verletzung: Datensatz darf nicht geändert/gelöscht werden.';
      } else if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'Eindeutigkeitsverletzung.';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Datensatz nicht gefunden.';
      } else {
        status = HttpStatus.BAD_REQUEST;
        message = `Datenbankfehler (${exception.code}).`;
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} -> ${status}`, exception instanceof Error ? exception.stack : undefined);
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
